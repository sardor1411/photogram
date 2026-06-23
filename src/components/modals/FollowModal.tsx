import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { S3Image } from '../S3Image';
import { useFollowStatus } from '../../queries';
import { X } from 'lucide-react';

export const FollowModal: React.FC<{
  userId: string;
  type: 'followers' | 'following';
  onClose: () => void;
  session: any;
  onUserPress: (id: string) => void;
}> = ({ userId, type, onClose, session, onUserPress }) => {
  const [searchQuery, setSearchQuery] = useState('');

  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['followList', type, userId, searchQuery],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * 20;
      const to = from + 19;
      // We need to use inner join format to filter on profiles: !inner
      const joinTable = type === 'followers' ? 'profiles!followers_follower_id_fkey!inner(*)' : 'profiles!followers_following_id_fkey!inner(*)';
      const matchCol = type === 'followers' ? 'following_id' : 'follower_id';

      let query = supabase
        .from('followers')
        .select(`*, ${joinTable}`)
        .eq(matchCol, userId)
        .range(from, to);

      if (searchQuery.trim()) {
        query = query.ilike('profiles.username', `%${searchQuery}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 20) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
  });

  const queryClient = useQueryClient();
  const currentUserId = session?.user?.id;

  const users = data?.pages.flat() || [];

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-auto bg-black/60"
    >
      <motion.div
        initial={{ y: 200, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 200, opacity: 0 }}
        className="w-full sm:w-[400px] h-[80vh] sm:h-[60vh] bg-[#111] rounded-t-3xl sm:rounded-3xl flex flex-col pt-4 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 pb-4 border-b border-neutral-800">
          <div className="w-8"></div>
          <h3 className="text-white font-bold text-lg">{type === 'followers' ? 'Followers' : 'Following'}</h3>
          <button onClick={onClose} className="w-8 h-8 flex justify-center items-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800">
            <X size={20}/>
          </button>
        </div>
        <div className="px-4 py-2 border-b border-neutral-800">
          <input
            type="text"
            placeholder={`Search ${type}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-neutral-900 text-white placeholder-neutral-500 rounded-xl px-4 py-2 outline-none focus:ring-1 focus:ring-neutral-700"
          />
        </div>
        <div 
          className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollHeight - el.scrollTop < el.clientHeight + 100 && hasNextPage) {
              fetchNextPage();
            }
          }}
        >
          {users.map((f, i) => {
            const profile = f.profiles;
            if (!profile) return null;
            return (
              <FollowUserRow 
                key={`${f.id}-${i}`} 
                profile={profile} 
                currentUserId={currentUserId} 
                queryClient={queryClient}
                onPress={() => {
                  onClose();
                  onUserPress(profile.id);
                }}
              />
            );
          })}
          {users.length === 0 && (
            <div className="text-center text-neutral-500 mt-10">
              No {type} found.
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

const FollowUserRow: React.FC<{ profile: any, currentUserId: string, queryClient: any, onPress: () => void }> = ({ profile, currentUserId, queryClient, onPress }) => {
  const { data: isFollowing } = useFollowStatus(currentUserId, profile.id);
  const [loading, setLoading] = useState(false);

  const toggleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    setLoading(true);
    try {
      if (isFollowing) {
        await supabase.from('followers').delete().eq('following_id', profile.id).eq('follower_id', currentUserId);
      } else {
        await supabase.from('followers').insert({ following_id: profile.id, follower_id: currentUserId });
      }
      queryClient.invalidateQueries({ queryKey: ['followStatus', currentUserId, profile.id] });
      queryClient.invalidateQueries({ queryKey: ['followCount', 'followers', profile.id] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between cursor-pointer group" onClick={onPress}>
      <div className="flex items-center gap-3">
        <S3Image src={profile.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'} className="w-12 h-12 rounded-full object-cover group-hover:opacity-80 transition-opacity" />
        <div>
          <h4 className="text-white font-bold text-sm">{profile.full_name || profile.username}</h4>
          <p className="text-neutral-400 text-xs text-left">@{profile.username}</p>
        </div>
      </div>
      {currentUserId && currentUserId !== profile.id && (
        <button 
          onClick={toggleFollow}
          disabled={loading}
          className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors ${
            isFollowing 
              ? 'bg-neutral-800 text-white hover:bg-neutral-700' 
              : 'bg-red-600 text-white hover:bg-red-700'
          }`}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  );
};
