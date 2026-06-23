import React from 'react';
import { motion } from 'motion/react';
import { Lock, Bell, Moon, Languages, Shield, LogOut, ChevronLeft } from 'lucide-react';
import { useSettings, useUpdateSettings } from '../../queries';

export const SettingsModal: React.FC<{ onClose: () => void, session: any, onSignOut: () => void }> = ({ onClose, session, onSignOut }) => {
  const currentUserId = session?.user?.id;
  const { data: settings } = useSettings(currentUserId);
  const updateSettings = useUpdateSettings();

  const isPrivate = settings?.is_private || false;
  const darkMode = settings?.dark_mode ?? true;
  const notificationsEnabled = settings?.notifications_enabled ?? true;

  const saveSettings = (k: string, v: any) => {
    if (!currentUserId) return;
    updateSettings.mutate({ userId: currentUserId, updates: { [k]: v } });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '100%' }}
      className="fixed inset-0 z-[100] bg-[#0f0f0f] flex flex-col pointer-events-auto"
    >
      <div className="sticky top-0 bg-[#0f0f0f]/90 backdrop-blur border-b border-neutral-900 p-4 pt-safe flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-neutral-800 text-white">
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-xl font-bold text-white">Settings</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        
        <div className="space-y-4">
          <h3 className="text-neutral-500 font-bold text-xs uppercase tracking-wider pl-2">Account & Privacy</h3>
          <div className="bg-neutral-900 rounded-2xl overflow-hidden">
            <SettingRow icon={<Lock size={20}/>} label="Private Account" hasToggle checked={isPrivate} onChange={(v: boolean) => saveSettings('is_private', v)} />
            <div className="h-[1px] bg-neutral-800 ml-12" />
            <SettingRow icon={<Shield size={20}/>} label="Security Options" onClick={() => alert('Coming soon')} />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-neutral-500 font-bold text-xs uppercase tracking-wider pl-2">Preferences</h3>
          <div className="bg-neutral-900 rounded-2xl overflow-hidden">
            <SettingRow icon={<Moon size={20}/>} label="Dark Mode" hasToggle checked={darkMode} onChange={(v: boolean) => saveSettings('dark_mode', v)} />
            <div className="h-[1px] bg-neutral-800 ml-12" />
            <SettingRow icon={<Bell size={20}/>} label="Notifications" hasToggle checked={notificationsEnabled} onChange={(v: boolean) => saveSettings('notifications_enabled', v)} />
            <div className="h-[1px] bg-neutral-800 ml-12" />
            <SettingRow icon={<Languages size={20}/>} label="Language" value={settings?.language === 'en' ? 'English' : settings?.language} onClick={() => alert('Coming soon')} />
          </div>
        </div>

        <div className="pt-6">
          <button 
            onClick={onSignOut}
            className="w-full bg-neutral-900 hover:bg-neutral-800 text-red-500 font-bold py-4 rounded-2xl transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={20} />
            Log out
          </button>
        </div>

      </div>
    </motion.div>
  );
};

const SettingRow = ({ icon, label, hasToggle, checked, onChange, value, onClick }: any) => {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center justify-between p-4 ${onClick ? 'cursor-pointer hover:bg-neutral-800 transition-colors' : ''}`}
    >
      <div className="flex items-center gap-3 text-white">
        <span className="text-neutral-400">{icon}</span>
        <span className="font-medium text-[15px]">{label}</span>
      </div>
      <div>
        {hasToggle ? (
          <button 
            onClick={() => onChange && onChange(!checked)}
            className={`w-12 h-6 rounded-full transition-colors flex items-center px-1 ${checked ? 'bg-[#E60023]' : 'bg-neutral-700'}`}
          >
            <motion.div 
              layout
              className="w-4 h-4 bg-white rounded-full"
              animate={{ x: checked ? 24 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          </button>
        ) : value ? (
          <span className="text-neutral-400 text-sm">{value}</span>
        ) : (
          <ChevronLeft size={20} className="text-neutral-600 rotate-180" />
        )}
      </div>
    </div>
  );
};
