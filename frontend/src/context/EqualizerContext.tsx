/**
 * Equalizer Context - Manages Web Audio API equalizer nodes
 * 
 * Provides:
 * - 10-band parametric EQ
 * - Built-in presets (Flat, Rock, Pop, Classical, Jazz, etc.)
 * - Custom user presets with persistence
 * - Bass boost and other effects
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useSettings } from './SettingsContext';

// EQ band frequencies (standard 10-band EQ frequencies)
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// EQ band labels for display
export const EQ_LABELS = ['32', '64', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];

// Gain range in dB
export const MIN_GAIN = -12;
export const MAX_GAIN = 12;

// EQ Preset type
export interface EQPreset {
  id: string;
  name: string;
  gains: number[]; // 10 values, one for each band (-12 to +12 dB)
  isCustom?: boolean;
}

// Built-in presets
export const BUILTIN_PRESETS: EQPreset[] = [
  {
    id: 'flat',
    name: 'Flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'bass-boost',
    name: 'Bass Boost',
    gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'treble-boost',
    name: 'Treble Boost',
    gains: [0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
  },
  {
    id: 'rock',
    name: 'Rock',
    gains: [5, 4, 2, 0, -1, -1, 2, 3, 4, 4],
  },
  {
    id: 'pop',
    name: 'Pop',
    gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  },
  {
    id: 'jazz',
    name: 'Jazz',
    gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  },
  {
    id: 'classical',
    name: 'Classical',
    gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  },
  {
    id: 'electronic',
    name: 'Electronic',
    gains: [5, 4, 2, 0, -2, -1, 0, 2, 4, 5],
  },
  {
    id: 'hip-hop',
    name: 'Hip-Hop',
    gains: [6, 5, 3, 1, -1, -1, 1, 0, 2, 3],
  },
  {
    id: 'acoustic',
    name: 'Acoustic',
    gains: [3, 2, 1, 1, 2, 1, 2, 2, 3, 2],
  },
  {
    id: 'vocal',
    name: 'Vocal Boost',
    gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  },
  {
    id: 'loudness',
    name: 'Loudness',
    gains: [5, 4, 2, 0, -2, -2, 0, 2, 4, 5],
  },
];

interface EqualizerState {
  enabled: boolean;
  activePresetId: string;
  gains: number[];
  customPresets: EQPreset[];
}

interface EqualizerContextValue {
  // State
  enabled: boolean;
  activePresetId: string;
  gains: number[];
  presets: EQPreset[]; // Built-in + custom
  customPresets: EQPreset[];
  
  // Actions
  setEnabled: (enabled: boolean) => void;
  setGain: (bandIndex: number, gain: number) => void;
  setGains: (gains: number[]) => void;
  selectPreset: (presetId: string) => void;
  saveCustomPreset: (name: string) => void;
  deleteCustomPreset: (presetId: string) => void;
  resetToFlat: () => void;
  
  // Audio node connection
  connectAudioSource: (source: AudioNode, destination: AudioNode, context: AudioContext) => void;
  disconnectAudio: () => void;
}

const EqualizerContext = createContext<EqualizerContextValue | null>(null);

export function EqualizerProvider({ children }: { children: React.ReactNode }) {
  const { getExtraSetting, updateExtraSetting } = useSettings();
  
  const [enabled, setEnabledState] = useState(true);
  const [activePresetId, setActivePresetId] = useState('flat');
  const [gains, setGainsState] = useState<number[]>(Array(10).fill(0));
  const [customPresets, setCustomPresets] = useState<EQPreset[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Load saved state from settings on mount
  useEffect(() => {
    const savedState = getExtraSetting('equalizer', null) as EqualizerState | null;
    if (savedState && !isInitialized) {
      if (savedState.enabled !== undefined) setEnabledState(savedState.enabled);
      if (savedState.activePresetId) setActivePresetId(savedState.activePresetId);
      if (savedState.gains?.length === 10) setGainsState(savedState.gains);
      if (savedState.customPresets) setCustomPresets(savedState.customPresets);
      setIsInitialized(true);
    }
  }, [getExtraSetting, isInitialized]);
  
  // Audio nodes
  const filtersRef = useRef<BiquadFilterNode[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioNode | null>(null);
  const destinationNodeRef = useRef<AudioNode | null>(null);
  const isConnectedRef = useRef(false);
  
  // All presets (built-in + custom)
  const allPresets = [...BUILTIN_PRESETS, ...customPresets];
  
  // Save state to settings
  const saveState = useCallback(async (state: Partial<EqualizerState>) => {
    const currentState: EqualizerState = {
      enabled,
      activePresetId,
      gains,
      customPresets,
      ...state,
    };
    await updateExtraSetting('equalizer', currentState);
  }, [enabled, activePresetId, gains, customPresets, updateExtraSetting]);
  
  // Apply gains to filter nodes
  const applyGains = useCallback((newGains: number[]) => {
    filtersRef.current.forEach((filter, index) => {
      if (filter && newGains[index] !== undefined) {
        filter.gain.value = enabled ? newGains[index] : 0;
      }
    });
  }, [enabled]);
  
  // Create filter nodes
  const createFilters = useCallback((context: AudioContext) => {
    // Clean up existing filters
    filtersRef.current = [];
    
    // Create 10 peaking filters for each frequency band
    EQ_FREQUENCIES.forEach((freq, index) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = 1.4; // Standard Q for 10-band EQ
      filter.gain.value = enabled ? gains[index] : 0;
      filtersRef.current.push(filter);
    });
    
    // Connect filters in series
    for (let i = 0; i < filtersRef.current.length - 1; i++) {
      filtersRef.current[i].connect(filtersRef.current[i + 1]);
    }
    
    return {
      input: filtersRef.current[0],
      output: filtersRef.current[filtersRef.current.length - 1],
    };
  }, [enabled, gains]);
  
  // Connect audio source through EQ
  const connectAudioSource = useCallback((
    source: AudioNode,
    destination: AudioNode,
    context: AudioContext
  ) => {
    // Store references
    audioContextRef.current = context;
    sourceNodeRef.current = source;
    destinationNodeRef.current = destination;
    
    // Create filters if needed
    if (filtersRef.current.length === 0) {
      createFilters(context);
    }
    
    // Connect: source -> EQ filters -> destination
    if (filtersRef.current.length > 0) {
      source.connect(filtersRef.current[0]);
      filtersRef.current[filtersRef.current.length - 1].connect(destination);
      isConnectedRef.current = true;
      console.log('[EQ] Connected audio source through equalizer');
    }
  }, [createFilters]);
  
  // Disconnect audio
  const disconnectAudio = useCallback(() => {
    if (isConnectedRef.current && sourceNodeRef.current && filtersRef.current.length > 0) {
      try {
        sourceNodeRef.current.disconnect();
        filtersRef.current.forEach(filter => filter.disconnect());
      } catch (e) {
        // Ignore disconnect errors
      }
      isConnectedRef.current = false;
    }
  }, []);
  
  // Toggle enabled
  const setEnabled = useCallback((newEnabled: boolean) => {
    setEnabledState(newEnabled);
    applyGains(newEnabled ? gains : Array(10).fill(0));
    saveState({ enabled: newEnabled });
  }, [gains, applyGains, saveState]);
  
  // Set single band gain
  const setGain = useCallback((bandIndex: number, gain: number) => {
    const newGains = [...gains];
    newGains[bandIndex] = Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain));
    setGainsState(newGains);
    setActivePresetId('custom');
    applyGains(newGains);
    saveState({ gains: newGains, activePresetId: 'custom' });
  }, [gains, applyGains, saveState]);
  
  // Set all gains
  const setGains = useCallback((newGains: number[]) => {
    const clampedGains = newGains.map(g => Math.max(MIN_GAIN, Math.min(MAX_GAIN, g)));
    setGainsState(clampedGains);
    applyGains(clampedGains);
    saveState({ gains: clampedGains });
  }, [applyGains, saveState]);
  
  // Select preset
  const selectPreset = useCallback((presetId: string) => {
    const preset = allPresets.find(p => p.id === presetId);
    if (preset) {
      setActivePresetId(presetId);
      setGainsState(preset.gains);
      applyGains(preset.gains);
      saveState({ activePresetId: presetId, gains: preset.gains });
    }
  }, [allPresets, applyGains, saveState]);
  
  // Save custom preset
  const saveCustomPreset = useCallback((name: string) => {
    const id = `custom-${Date.now()}`;
    const newPreset: EQPreset = {
      id,
      name,
      gains: [...gains],
      isCustom: true,
    };
    const newCustomPresets = [...customPresets, newPreset];
    setCustomPresets(newCustomPresets);
    setActivePresetId(id);
    saveState({ customPresets: newCustomPresets, activePresetId: id });
  }, [gains, customPresets, saveState]);
  
  // Delete custom preset
  const deleteCustomPreset = useCallback((presetId: string) => {
    const newCustomPresets = customPresets.filter(p => p.id !== presetId);
    setCustomPresets(newCustomPresets);
    if (activePresetId === presetId) {
      setActivePresetId('flat');
      setGainsState(Array(10).fill(0));
      applyGains(Array(10).fill(0));
    }
    saveState({ 
      customPresets: newCustomPresets, 
      activePresetId: activePresetId === presetId ? 'flat' : activePresetId,
      gains: activePresetId === presetId ? Array(10).fill(0) : gains,
    });
  }, [customPresets, activePresetId, gains, applyGains, saveState]);
  
  // Reset to flat
  const resetToFlat = useCallback(() => {
    selectPreset('flat');
  }, [selectPreset]);
  
  // Apply gains when enabled changes
  useEffect(() => {
    applyGains(enabled ? gains : Array(10).fill(0));
  }, [enabled, gains, applyGains]);
  
  return (
    <EqualizerContext.Provider
      value={{
        enabled,
        activePresetId,
        gains,
        presets: allPresets,
        customPresets,
        setEnabled,
        setGain,
        setGains,
        selectPreset,
        saveCustomPreset,
        deleteCustomPreset,
        resetToFlat,
        connectAudioSource,
        disconnectAudio,
      }}
    >
      {children}
    </EqualizerContext.Provider>
  );
}

export function useEqualizer() {
  const context = useContext(EqualizerContext);
  if (!context) {
    throw new Error('useEqualizer must be used within EqualizerProvider');
  }
  return context;
}
