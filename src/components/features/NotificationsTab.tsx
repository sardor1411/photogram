import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Bell, Heart, MessageCircle, UserPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select(`*, actor:profiles!notifications_actor_id_fkey(*)`)
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 1000 * 30, // Poll every 30s
  });
}

export function useMarkNotificationsRead(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) return;
      await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    }
  });
}

export const NotificationsTab: React.FC<{ session: any, onUserPress: (id: string) => void, onPinPress: (p: any) => void, onBack: () => void }> = ({ session, onUserPress, onPinPress, onBack }) => {
  const userId = session?.user?.id;
  const { data: notifications = [], isLoading } = useNotifications(userId);
  const markRead = useMarkNotificationsRead(userId);
  const [filter, setFilter] = useState<'all' | 'like' | 'comment' | 'follow'>('all');

  React.useEffect(() => {
    if (notifications.some(n => !n.is_read)) {
      markRead.mutate();
    }
  }, [notifications]);

  const filteredNotifications = React.useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter(n => n.type === filter);
  }, [notifications, filter]);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex flex-col h-[100dvh] bg-[#0f0f0f]">
      <div className="sticky top-0 bg-[#0f0f0f]/95 backdrop-blur border-b border-neutral-900 p-4 pt-safe flex flex-col gap-3.5 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-neutral-800 text-white">
            <ChevronLeft size={24} />
          </button>
          <h2 className="text-xl font-bold text-white">Bildirishnomalar</h2>
        </div>

        {/* Categories toggles exactly matching: agar hammasi bolsa hammasi chiqsin va h.k */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${filter === 'all' ? 'bg-white text-black' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
          >
            All (Hammasi)
          </button>
          <button
            onClick={() => setFilter('like')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${filter === 'like' ? 'bg-white text-black' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
          >
            ❤️ Layklar
          </button>
          <button
            onClick={() => setFilter('comment')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${filter === 'comment' ? 'bg-white text-black' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
          >
            💬 Kommentlar
          </button>
          <button
            onClick={() => setFilter('follow')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1 ${filter === 'follow' ? 'bg-white text-black' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
          >
            👤 Obunalar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="text-center text-neutral-500 mt-10">Loading...</div>
        ) : filteredNotifications.length === 0 ? (
          <div className="text-center text-neutral-500 mt-20 flex flex-col items-center">
            <Bell size={48} className="text-neutral-700 mb-4" />
            <p className="text-white font-bold text-lg">Hozircha bildirishnoma yo'q</p>
            <p className="text-sm mt-2 max-w-xs mx-auto">Tanlangan ruknda hech qanday yangilik topilmadi.</p>
          </div>
        ) : (
          filteredNotifications.map(n => (
            <div key={n.id} className={`flex items-center gap-3 p-3 rounded-2xl ${n.is_read ? 'opacity-70' : 'bg-neutral-900'}`}>
              <div onClick={() => onUserPress(n.actor.id)} className="cursor-pointer relative">
                <img src={n.actor?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${n.actor?.id}`} alt="" className="w-12 h-12 rounded-full object-cover" />
                <div className="absolute -bottom-1 -right-1 bg-[#0f0f0f] rounded-full p-0.5">
                  {n.type === 'like' && <Heart size={14} className="text-[#E60023] fill-[#E60023]" />}
                  {n.type === 'comment' && <MessageCircle size={14} className="text-blue-500 fill-blue-500" />}
                  {n.type === 'reply' && <MessageCircle size={14} className="text-green-500 fill-green-500" />}
                  {n.type === 'follow' && <UserPlus size={14} className="text-purple-500" />}
                </div>
              </div>
              
              <div className="flex-1">
                <p className="text-sm text-white">
                  <span className="font-bold cursor-pointer" onClick={() => onUserPress(n.actor.id)}>{n.actor?.username || 'Someone'}</span>
                  {' '}
                  {n.type === 'like' && 'liked your pin.'}
                  {n.type === 'comment' && 'commented on your pin.'}
                  {n.type === 'reply' && 'replied to your comment.'}
                  {n.type === 'follow' && 'started following you.'}
                </p>
                <p className="text-xs text-neutral-500">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}</p>
              </div>

              {n.pin_id && (
                <button 
                  onClick={() => onPinPress({ id: n.pin_id })} 
                  className="w-12 h-12 rounded-xl bg-neutral-800 shrink-0 overflow-hidden"
                >
                  {/* Pin thumbnail could go here if we fetched it */}
                  <div className="w-full h-full bg-neutral-800" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
};
