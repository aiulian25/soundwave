import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Achievement } from '../types';
import AchievementNotification from '../components/AchievementNotification';

interface AchievementNotificationContextType {
  showAchievements: (achievements: Achievement[]) => void;
}

const AchievementNotificationContext = createContext<AchievementNotificationContextType | undefined>(undefined);

export function AchievementNotificationProvider({ children }: { children: ReactNode }) {
  const [pendingAchievements, setPendingAchievements] = useState<Achievement[]>([]);

  const showAchievements = useCallback((achievements: Achievement[]) => {
    if (achievements.length > 0) {
      setPendingAchievements(achievements);
    }
  }, []);

  const handleClose = useCallback(() => {
    setPendingAchievements([]);
  }, []);

  return (
    <AchievementNotificationContext.Provider value={{ showAchievements }}>
      {children}
      {pendingAchievements.length > 0 && (
        <AchievementNotification
          achievements={pendingAchievements}
          onClose={handleClose}
        />
      )}
    </AchievementNotificationContext.Provider>
  );
}

export function useAchievementNotification() {
  const context = useContext(AchievementNotificationContext);
  if (context === undefined) {
    throw new Error('useAchievementNotification must be used within an AchievementNotificationProvider');
  }
  return context;
}
