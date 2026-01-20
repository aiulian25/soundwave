/**
 * Custom hook for managing drag-and-drop sorting with backend + localStorage persistence
 * When user is logged in, syncs order to backend via extra_settings
 * Falls back to localStorage only when not logged in
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { DragEndEvent } from '@dnd-kit/core';

interface UseSortableItemsOptions<T> {
  items: T[];
  storageKey: string;
  getItemId: (item: T) => string | number;
  // Functions from SettingsContext to sync with backend
  getExtraSetting?: (key: string, defaultValue?: any) => any;
  updateExtraSetting?: (key: string, value: any) => Promise<boolean>;
}

export function useSortableItems<T>({ 
  items, 
  storageKey, 
  getItemId,
  getExtraSetting,
  updateExtraSetting,
}: UseSortableItemsOptions<T>) {
  const [sortedItems, setSortedItems] = useState<T[]>(items);
  const [customOrder, setCustomOrder] = useState<(string | number)[] | null>(null);
  const [orderLoaded, setOrderLoaded] = useState(false);
  const initialLoadRef = useRef(true);

  // Check if backend sync is available (user is logged in)
  const hasBackendSync = Boolean(getExtraSetting && updateExtraSetting);

  // Load saved order - prefer backend, fallback to localStorage
  useEffect(() => {
    const loadOrder = () => {
      let savedOrder: (string | number)[] | null = null;

      // Try to get from backend first (if available)
      if (hasBackendSync && getExtraSetting) {
        const backendOrder = getExtraSetting(storageKey, null);
        if (backendOrder && Array.isArray(backendOrder)) {
          savedOrder = backendOrder;
        }
      }

      // Fallback to localStorage if no backend order
      if (!savedOrder) {
        const localOrder = localStorage.getItem(storageKey);
        if (localOrder) {
          try {
            const parsed = JSON.parse(localOrder);
            if (Array.isArray(parsed)) {
              savedOrder = parsed;
              // If we have backend sync but got order from localStorage, migrate it to backend
              if (hasBackendSync && updateExtraSetting) {
                updateExtraSetting(storageKey, parsed);
              }
            }
          } catch (e) {
            console.error('Failed to parse saved order:', e);
          }
        }
      }

      if (savedOrder) {
        setCustomOrder(savedOrder);
      }
      setOrderLoaded(true);
    };

    // Only load once on initial mount or when backend sync becomes available
    if (initialLoadRef.current) {
      loadOrder();
      initialLoadRef.current = false;
    }
  }, [storageKey, hasBackendSync, getExtraSetting, updateExtraSetting]);

  // Also reload when getExtraSetting changes (settings loaded from backend)
  useEffect(() => {
    if (hasBackendSync && getExtraSetting && orderLoaded) {
      const backendOrder = getExtraSetting(storageKey, null);
      if (backendOrder && Array.isArray(backendOrder)) {
        setCustomOrder(backendOrder);
      }
    }
  }, [hasBackendSync, getExtraSetting, storageKey, orderLoaded]);

  // Apply custom order to items when items or order changes
  useEffect(() => {
    if (customOrder && items.length > 0) {
      const orderedItems = [...items].sort((a, b) => {
        const aIndex = customOrder.indexOf(getItemId(a));
        const bIndex = customOrder.indexOf(getItemId(b));
        
        // Items not in the order go to the end
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        
        return aIndex - bIndex;
      });
      setSortedItems(orderedItems);
    } else {
      setSortedItems(items);
    }
  }, [items, customOrder, getItemId]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setSortedItems((items) => {
        const oldIndex = items.findIndex((item) => getItemId(item) === active.id);
        const newIndex = items.findIndex((item) => getItemId(item) === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // Save the new order
        const newOrder = newItems.map(getItemId);
        
        // Always save to localStorage as cache
        localStorage.setItem(storageKey, JSON.stringify(newOrder));
        
        // Save to backend if available
        if (hasBackendSync && updateExtraSetting) {
          updateExtraSetting(storageKey, newOrder);
        }
        
        setCustomOrder(newOrder);

        return newItems;
      });
    }
  }, [getItemId, storageKey, hasBackendSync, updateExtraSetting]);

  const resetOrder = useCallback(() => {
    // Clear from localStorage
    localStorage.removeItem(storageKey);
    
    // Clear from backend if available
    if (hasBackendSync && updateExtraSetting) {
      updateExtraSetting(storageKey, null);
    }
    
    setCustomOrder(null);
    setSortedItems(items);
  }, [storageKey, items, hasBackendSync, updateExtraSetting]);

  return {
    sortedItems,
    handleDragEnd,
    resetOrder,
    hasCustomOrder: customOrder !== null,
  };
}
