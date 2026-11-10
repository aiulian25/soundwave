import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Audio } from '../types';
import { useEqualizer } from '../context/EqualizerContext';
import { useSettings } from '../context/SettingsContext';
import { releaseWakeLock, requestWakeLock } from '../utils/wakeLock';

// EQ frequencies (10-band)
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

interface AudioGraphInputs {
  audioRef: RefObject<HTMLAudioElement>;
  /** The element whose glow follows the music. */
  playerContainerRef: RefObject<HTMLDivElement>;
  audio: Audio;
  streamUrl: string;
  loadingStream: boolean;
  isPlaying: boolean;
}

/**
 * The Web Audio side of the player: the graph behind the visualizer, the equalizer and loudness
 * normalization, built only when one of them is wanted, and the screen wake lock that a live
 * graph needs. Returns what the visualizer reads each frame.
 */
export function usePlayerAudioGraph({ audioRef, playerContainerRef, audio, streamUrl, loadingStream, isPlaying }: AudioGraphInputs) {
  const { settings, getExtraSetting } = useSettings();
  const { enabled: eqEnabled, gains: eqGains } = useEqualizer();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const normGainRef = useRef<GainNode | null>(null);  // F9 loudness-normalization gain
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const [graphReady, setGraphReady] = useState(false);  // Web Audio graph built (F9)

  // iOS Audio Context resume - Safari requires user interaction to start AudioContext
  useEffect(() => {
    const resumeAudioContext = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        if (import.meta.env.DEV) console.log('[Player] Resuming suspended AudioContext (iOS)');
        audioContextRef.current.resume().catch(console.error);
      }
    };
    
    // Resume on user interaction
    const events = ['touchstart', 'touchend', 'click', 'keydown'];
    events.forEach(event => {
      document.addEventListener(event, resumeAudioContext, { once: true, passive: true });
    });
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, resumeAudioContext);
      });
    };
  }, []);

  // Wake Lock — only while it is actually needed.
  //
  // Audio routed through Web Audio is suspended by the browser when the page is hidden, so a
  // graph means the screen has to stay awake. Plain <audio> playback uses the OS media path and
  // keeps going with the screen off, so holding the lock there just burns the display and GPU
  // for the whole session.
  //
  // Gated on graphReady (a graph EXISTS) rather than wantsAudioGraph (the user wants one): after
  // Step 5's lazy build those diverge when the visualizer is switched off mid-session, and the
  // graph outlives the setting. Releasing the lock while the graph is live would stop playback
  // as soon as the screen slept.
  const keepScreenOn = getExtraSetting('keep_screen_on', false) === true;

  useEffect(() => {
    if (isPlaying && !loadingStream && (graphReady || keepScreenOn)) {
      // Request wake lock when playing
      requestWakeLock().catch(() => {
        // Wake lock request can fail on some devices, but audio will still play
        // (just might stop if screen turns off)
      });
    } else {
      // Release wake lock when not needed
      releaseWakeLock();
    }
    
    // Cleanup on unmount
    return () => {
      releaseWakeLock();
    };
  }, [isPlaying, loadingStream, graphReady, keepScreenOn]);

  // Only the visualizer and the equalizer need the Web Audio graph. Routing audio through
  // createMediaElementSource takes it off the platform's native media path — which costs
  // continuous DSP (ten biquads, an analyser) and makes the browser suspend playback when the
  // page is hidden. With both features off we never build it, and the <audio> element keeps
  // using the OS pipeline.
  //
  // Built lazily rather than torn down on toggle: createMediaElementSource can only be called
  // once per element and a connected element can never return to native output, so "off" after
  // "on" would require remounting <audio> — an audible gap mid-track, and a rebuild hazard.
  // Enabling either feature builds the graph at that moment; disabling it leaves the graph in
  // place until the player is closed, and the next session starts native again.
  const wantsAudioGraph = settings.visualizer_enabled || eqEnabled;

  // Initialize Web Audio API for visualizer and EQ - optimized for performance
  useEffect(() => {
    if (!audioRef.current || !streamUrl || !wantsAudioGraph) return;
    let cancelled = false;

    // Create audio context, EQ filters, and analyser - deferred to avoid blocking
    if (!audioContextRef.current) {
      // Use requestIdleCallback or setTimeout to avoid blocking track start
      const initAudioChain = () => {
        if (cancelled || !audioRef.current) return; // don't build a graph after unmount
        try {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          sourceNodeRef.current = audioContextRef.current.createMediaElementSource(audioRef.current!);
          
          // Create 10-band EQ filters - all start at 0 gain (pass-through)
          eqFiltersRef.current = EQ_FREQUENCIES.map((freq) => {
            const filter = audioContextRef.current!.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4; // Standard Q for 10-band EQ
            filter.gain.value = 0; // Pass-through until EQ is enabled
            return filter;
          });
          
          // Create analyser for visualizer - optimized settings
          analyserRef.current = audioContextRef.current.createAnalyser();
          analyserRef.current.fftSize = 64; // 32 frequency bins (minimal for visualization)
          analyserRef.current.smoothingTimeConstant = 0.85; // Slightly more smoothing = less CPU
          analyserRef.current.minDecibels = -90;
          analyserRef.current.maxDecibels = -10;
          
          // Connect chain: source -> EQ filters -> analyser -> destination
          let lastNode: AudioNode = sourceNodeRef.current;
          
          // Connect EQ filters in series
          eqFiltersRef.current.forEach((filter) => {
            lastNode.connect(filter);
            lastNode = filter;
          });
          
          // Normalization gain (F9): make-up gain toward the target LUFS. Unity (1.0) by
          // default; the effect below sets it from the track's measured loudness + the
          // user's setting. Inserted between the EQ chain and the analyser so the
          // visualizer reflects the normalized level.
          normGainRef.current = audioContextRef.current.createGain();
          normGainRef.current.gain.value = 1;
          lastNode.connect(normGainRef.current);
          lastNode = normGainRef.current;

          // Connect to analyser and then to destination
          lastNode.connect(analyserRef.current);
          analyserRef.current.connect(audioContextRef.current.destination);

          dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
          setGraphReady(true);
          if (import.meta.env.DEV) console.log('[Player] Audio chain initialized (optimized)');
        } catch (error) {
          console.error('Web Audio API not supported:', error);
        }
      };

      // Defer initialization slightly to not block audio playback start. The
      // `cancelled` guard stops a pending idle callback from building a graph on a
      // detached element after the Player unmounts.
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(initAudioChain, { timeout: 100 });
      } else {
        setTimeout(initAudioChain, 0);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [streamUrl, wantsAudioGraph, audioRef]);

  // Read the latest 16 visualizer bars straight from the analyser. Passed to
  // <AudioVisualizer>, which calls it inside its own canvas RAF — so the Player no
  // longer pushes state ~60x/second (which forced a full re-render of this component).
  const getBars = useCallback((): number[] => {
    const analyser = analyserRef.current;
    const arr = dataArrayRef.current;
    if (!analyser || !arr) return Array(16).fill(0);
    analyser.getByteFrequencyData(arr as any);
    const bars: number[] = [];
    const step = Math.floor(arr.length / 16) || 1;
    for (let i = 0; i < 16; i++) {
      const index = Math.min(i * step, arr.length - 1);
      const value = arr[index] / 255;
      const boost = i < 8 ? 1.3 : 1.0; // boost bass/mid
      bars.push(Math.min(value * boost, 1));
    }
    return bars;
  }, []);

  // Drive the background glow via a CSS variable (no React re-render). The visualizer
  // calls this each frame with the current peak (0–1).
  const handleVizIntensity = useCallback((value: number) => {
    playerContainerRef.current?.style.setProperty('--sw-viz-intensity', value.toFixed(3));
  }, [playerContainerRef]);

  // Reset the glow when the visualizer is turned off so it doesn't freeze mid-glow.
  useEffect(() => {
    if (!settings.visualizer_enabled) {
      playerContainerRef.current?.style.setProperty('--sw-viz-intensity', '0');
    }
  }, [settings.visualizer_enabled, playerContainerRef]);

  // Loudness normalization make-up gain (F9). Recomputes when the track, its measured
  // loudness, the normalization setting, or graph readiness changes. Off (or unmeasured)
  // => unity gain (bit-identical to no normalization).
  useEffect(() => {
    const g = normGainRef.current;
    const ctx = audioContextRef.current;
    if (!g) return;
    const norm = getExtraSetting('normalization', { enabled: false, targetLufs: -14 }) || {};
    let linear = 1;
    if (norm.enabled && typeof audio.loudness_lufs === 'number') {
      const target = typeof norm.targetLufs === 'number' ? norm.targetLufs : -14;
      const dB = Math.max(-12, Math.min(12, target - audio.loudness_lufs));
      linear = Math.pow(10, dB / 20);
    }
    try {
      if (ctx) g.gain.setTargetAtTime(linear, ctx.currentTime, 0.05);  // smooth, click-free
      else g.gain.value = linear;
    } catch {
      g.gain.value = linear;
    }
  }, [audio.id, audio.loudness_lufs, settings.extra_settings, graphReady, getExtraSetting]);

  // Tear down the Web Audio graph on unmount — the effect above intentionally never
  // closes it (the graph persists across track changes). Without this, every Player
  // remount (breakpoint flip, stop, StrictMode) leaks an AudioContext + nodes, and
  // browsers cap ~6 contexts before throwing.
  useEffect(() => {
    return () => {
      eqFiltersRef.current.forEach((f) => {
        try { f.disconnect(); } catch { /* already disconnected */ }
      });
      try { normGainRef.current?.disconnect(); } catch { /* noop */ }
      try { analyserRef.current?.disconnect(); } catch { /* noop */ }
      try { sourceNodeRef.current?.disconnect(); } catch { /* noop */ }
      const ctx = audioContextRef.current;
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(() => { /* already closing */ });
      }
      audioContextRef.current = null;
      sourceNodeRef.current = null;
      analyserRef.current = null;
      normGainRef.current = null;
      eqFiltersRef.current = [];
      dataArrayRef.current = null;
    };
  }, []);

  // Apply EQ gains when they change - optimized to set all gains at once
  useEffect(() => {
    if (eqFiltersRef.current.length > 0) {
      // Batch update all filter gains - more efficient than individual updates
      const targetGains = eqEnabled ? eqGains : Array(10).fill(0);
      eqFiltersRef.current.forEach((filter, index) => {
        // Only update if value actually changed
        if (filter.gain.value !== targetGains[index]) {
          filter.gain.value = targetGains[index];
        }
      });
    }
  }, [eqGains, eqEnabled]);

  return { getBars, handleVizIntensity };
}
