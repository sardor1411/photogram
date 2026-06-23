import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, useMock } from '../../lib/supabase';
import { findOrCreateConversation } from '../../lib/conversation';
import { Search, Send, Check, X } from 'lucide-react';
import { S3Image } from '../S3Image';

interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  pin: {
    id: string;
    title: string;
    imageUrl: string;
    description?: string;
  };
  currentUserId: string | undefined;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, pin, currentUserId }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sentStatus, setSentStatus] = useState<Record<string, 'idle' | 'sending' | 'sent'>>({});

  useEffect(() => {
    if (!isOpen || !currentUserId) return;

    const fetchProfiles = async () => {
      setIsLoading(true);
      try {
        let query = supabase.from('profiles').select('*').neq('id', currentUserId);
        
        if (searchQuery.trim()) {
          query = query.or(`username.ilike.%${searchQuery}%,full_name.ilike.%${searchQuery}%`);
        }
        
        const { data, error } = await query.limit(15);
        if (!error && data) {
          setUsers(data as Profile[]);
        }
      } catch (err) {
        console.error('Error fetching profiles:', err);
      } finally {
        setIsLoading(false);
      }
    };

    const timer = setTimeout(fetchProfiles, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, currentUserId]);

  const handleShareToUser = async (targetUser: Profile) => {
    if (!currentUserId || useMock) return;
    
    setSentStatus(prev => ({ ...prev, [targetUser.id]: 'sending' }));

    try {
      // 1. Find or create conversation using the dynamic schema-aware helper
      const convId = await findOrCreateConversation(currentUserId, targetUser.id);

      if (!convId) throw new Error('Suhbat ID sini aniqlab boʻlmadi');

      // 2. Insert message into conversation with appropriate message_type
      const { error: msgErr } = await supabase.from('messages').insert({
        conversation_id: convId,
        sender_id: currentUserId,
        content: `[PIN_SHARE:${pin.id}]`,
        message_type: 'text' // strictly defined in schema message_type
      });

      if (msgErr) throw msgErr;

      // 3. Update conversation last activity timestamp (last_message_at)
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', convId);

      // 4. Send notification
      supabase.from('notifications').insert({
        user_id: targetUser.id,
        actor_id: currentUserId,
        type: 'message'
      }).then();

      setSentStatus(prev => ({ ...prev, [targetUser.id]: 'sent' }));
    } catch (err: any) {
      console.error('Error sharing pin:', err);
      let errMsg = "Ulashishda xatolik yuz berdi.";
      alert(errMsg);
      setSentStatus(prev => ({ ...prev, [targetUser.id]: 'idle' }));
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-3xl p-6 shadow-2xl flex flex-col max-h-[85vh] z-10 overflow-hidden"
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-white font-bold text-lg select-none">Inboxga yuborish</h3>
              <button onClick={onClose} className="text-neutral-400 hover:text-white transition-colors p-1.5 hover:bg-neutral-800 rounded-full">
                <X size={20} />
              </button>
            </div>

            {/* Pin Preview Small */}
            <div className="flex gap-3 bg-neutral-950 p-3 rounded-2xl mb-4 items-center border border-neutral-800/40">
              <img src={pin.imageUrl} className="w-12 h-12 rounded-xl object-cover shrink-0" />
              <div className="text-left overflow-hidden">
                <h4 className="text-white text-xs font-bold truncate">{pin.title}</h4>
                <p className="text-neutral-500 text-[11px] truncate">{pin.description || 'Yuborish uchun tayyor'}</p>
              </div>
            </div>

            {/* Search Input */}
            <div className="relative mb-4">
              <Search size={18} className="absolute left-4 top-3.5 text-neutral-500" />
              <input 
                type="text"
                placeholder="Foydalanuvchilarni qidirish..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl pl-11 pr-4 py-3 text-white text-sm focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            {/* User List */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[250px] no-scrollbar">
              {users.map((u) => {
                const status = sentStatus[u.id] || 'idle';
                return (
                  <div key={u.id} className="flex items-center justify-between p-2 rounded-2xl hover:bg-neutral-800/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <S3Image 
                        src={u.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.id}`} 
                        className="w-10 h-10 rounded-full object-cover shrink-0" 
                        skeletonClassName="rounded-full"
                      />
                      <div className="text-left">
                        <h4 className="text-white text-xs font-bold leading-tight">{u.full_name || u.username}</h4>
                        <span className="text-neutral-500 text-[11px]">@{u.username}</span>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => handleShareToUser(u)}
                      disabled={status !== 'idle'}
                      className={`px-4 py-2 rounded-full text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                        status === 'sent' 
                          ? 'bg-neutral-800 text-neutral-400' 
                          : status === 'sending'
                          ? 'bg-red-600/55 text-white animate-pulse'
                          : 'bg-[#E60023] hover:bg-red-700 text-white active:scale-95'
                      }`}
                    >
                      {status === 'sent' ? (
                        <>
                          <Check size={12} className="stroke-[3px]" />
                          <span>Yuborildi</span>
                        </>
                      ) : status === 'sending' ? (
                        <span>Yuborilmoqda...</span>
                      ) : (
                        <span>Yuborish</span>
                      )}
                    </button>
                  </div>
                );
              })}

              {!isLoading && users.length === 0 && (
                <div className="text-neutral-500 text-center py-10">
                  <p className="text-sm">Hech kim topilmadi.</p>
                </div>
              )}

              {isLoading && (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 rounded-full border-2 border-neutral-800 border-t-red-600 animate-spin" />
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
