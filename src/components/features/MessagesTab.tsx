import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, useMock } from '../../lib/supabase';
import { findOrCreateConversation } from '../../lib/conversation';
import { getS3ObjectUrl, uploadToS3 } from '../../lib/s3';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { S3Image } from '../S3Image';
import { ChevronLeft, ChevronRight, Send, MessageCircle, AlertTriangle, MoreVertical, User, UserX, Edit2, Image as ImageIcon, Smile, Reply, Trash2, Search, X, Loader2, Check, CheckCheck, Heart, Phone, Plus, FolderSync, UserCheck, Music } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// -----------------------------------------------------------------------------
// Block helper utilities using local storage synchronized across views
// -----------------------------------------------------------------------------
export const getBlockedRelationsLocal = (): { blocker_id: string; blocked_id: string }[] => {
  try {
    return JSON.parse(localStorage.getItem('blocked_user_relations') || '[]');
  } catch {
    return [];
  }
};

export const blockUserLocal = (blockerId: string, blockedId: string) => {
  const list = getBlockedRelationsLocal();
  if (!list.some(r => r.blocker_id === blockerId && r.blocked_id === blockedId)) {
    list.push({ blocker_id: blockerId, blocked_id: blockedId });
    localStorage.setItem('blocked_user_relations', JSON.stringify(list));
  }
};

export const unblockUserLocal = (blockerId: string, blockedId: string) => {
  let list = getBlockedRelationsLocal();
  list = list.filter(r => !(r.blocker_id === blockerId && r.blocked_id === blockedId));
  localStorage.setItem('blocked_user_relations', JSON.stringify(list));
};

export const isUserBlockedByMe = (myId: string, theirId: string): boolean => {
  if (!myId || !theirId) return false;
  const list = getBlockedRelationsLocal();
  return list.some(r => r.blocker_id === myId && r.blocked_id === theirId);
};

export const amIBlockedByThem = (myId: string, theirId: string): boolean => {
  if (!myId || !theirId) return false;
  const list = getBlockedRelationsLocal();
  return list.some(r => r.blocker_id === theirId && r.blocked_id === myId);
};

export const isBlockedEitherWay = (userA: string, userB: string): boolean => {
  if (!userA || !userB) return false;
  const list = getBlockedRelationsLocal();
  return list.some(r => 
    (r.blocker_id === userA && r.blocked_id === userB) || 
    (r.blocker_id === userB && r.blocked_id === userA)
  );
};

// Parse custom JSON payload dynamically or gracefully process plain text
export const parseMessage = (m: any) => {
  let isRich = false;
  let textContent = m?.content || '';
  let replyTo = null;
  let reactions = [];
  let is_edited = false;
  let is_deleted = false;

  const trimmed = (m?.content || '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed._isRich) {
        isRich = true;
        textContent = parsed.text || '';
        replyTo = parsed.replyTo || null;
        reactions = parsed.reactions || [];
        is_edited = !!parsed.is_edited;
        is_deleted = !!parsed.is_deleted;
      }
    } catch (e) {
      // Fallback to normal string
    }
  }

  return { isRich, textContent, replyTo, reactions, is_edited, is_deleted };
};

// -----------------------------------------------------------------------------
// Database Sync Alert Box
// -----------------------------------------------------------------------------
const DatabaseSyncAlert: React.FC<{ error: any }> = ({ error }) => {
  const [copied, setCopied] = useState(false);
  const sqlCode = `-- 1. Suhbatlar (Conversations) jadvalini yangilash
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS user1_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS user2_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Unikallik cheklovi (bitta juftlik uchun faqat 1ta suhbat bo'lishi uchun)
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user1_id_user2_id_key;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_user1_id_user2_id_key UNIQUE (user1_id, user2_id);

-- 2. Xabarlar (Messages) jadvalini yangilash
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      alert("Nusxalashda xatolik yuz berdi");
    }
  };

  return (
    <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-3xl text-left space-y-4 max-w-lg mx-auto my-6 select-text">
      <h3 className="text-red-500 font-bold text-sm flex items-center gap-2">
        <AlertTriangle size={18} />
        <span>Supabase Sozlash Kerak</span>
      </h3>
      <p className="text-neutral-300 text-xs leading-relaxed">
        Sizning Supabase ma'lumotlar bazangizda xabarlar uchun zarur ko'rsatkichlar yetishmayapti. Iltimos, quyidagi SQL kodini nusxalab, Supabase <b>SQL Editor</b> bo'limida ishga tushiring:
      </p>
      
      <div className="relative bg-neutral-950 p-4 rounded-2xl text-[11px] font-mono text-neutral-400 overflow-x-auto border border-neutral-800">
        <pre className="text-green-400 overflow-x-auto whitespace-pre-wrap select-all">{sqlCode}</pre>
        <button 
          onClick={handleCopy}
          className="absolute top-2 right-2 px-3 py-1 bg-[#E60023] hover:bg-red-700 active:scale-95 text-white text-[10px] font-bold rounded-lg transition-all"
        >
          {copied ? "Nusxalandi! ✓" : "Nusxalash"}
        </button>
      </div>
      <p className="text-neutral-500 text-[10px]">
        Tizim xatosi: <code className="font-mono">{error?.message || error?.code || 'PGRST102'}</code>
      </p>
    </div>
  );
};


// -----------------------------------------------------------------------------
// Interactive Shared Post Visual Card
// -----------------------------------------------------------------------------
const SharedPinMessage: React.FC<{ pinId: string; onPinPress: (pin: any) => void }> = ({ pinId, onPinPress }) => {
  const { data: pin, isLoading, error } = useQuery({
    queryKey: ['shared_pin', pinId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pins')
        .select('*, pin_media(*)')
        .eq('id', pinId)
        .single();
      if (error) throw error;
      
      const media = data.pin_media?.[0] || {};
      const actualImgUrl = media.media_url || media.thumbnail_url || '';
      const resolvedUrl = actualImgUrl ? await getS3ObjectUrl(actualImgUrl) : '';

      // Map properties to match WebPin structure
      return {
        id: data.id,
        imageUrl: resolvedUrl,
        title: data.title,
        description: data.description || '',
        userId: data.user_id,
        likesCount: data.likes_count || 0,
        width: media.width || 500,
        height: media.height || 300
      };
    },
    staleTime: 1000 * 60 * 5
  });

  if (isLoading) {
    return (
      <div className="w-56 h-44 bg-neutral-900 animate-pulse rounded-2xl flex items-center justify-center border border-neutral-800">
        <div className="w-5 h-5 rounded-full border-2 border-neutral-700 border-t-red-600 animate-spin" />
      </div>
    );
  }

  if (error || !pin) {
    return (
      <div className="text-[11px] text-neutral-500 p-3 italic bg-neutral-950 border border-neutral-900 rounded-2xl">
        Ulashilgan post topilmadi yoki o'chirilgan.
      </div>
    );
  }

  return (
    <div 
      onClick={() => onPinPress(pin)}
      className="w-56 overflow-hidden rounded-2xl bg-neutral-950 hover:bg-neutral-900 transition-colors border border-neutral-800 cursor-pointer text-left select-none shadow-xl active:scale-98"
    >
      <div className="relative h-32 bg-black flex items-center justify-center overflow-hidden">
        <S3Image src={pin.imageUrl} className="w-full h-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
      </div>
      <div className="p-3">
        <h4 className="text-white text-[13px] font-bold truncate leading-snug">{pin.title}</h4>
        <p className="text-neutral-500 text-[11px] line-clamp-1 mt-0.5">{pin.description || 'No description'}</p>
        <div className="flex items-center justify-between text-neutral-400 text-[10px] mt-2 font-semibold uppercase tracking-wider text-red-500">
          <span>Postni ko'rish</span>
          <ChevronRight size={12} />
        </div>
      </div>
    </div>
  );
};


// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------
export function useUnreadMessages(userId: string | undefined) {
  return useQuery({
    queryKey: ['unread_messages', userId],
    enabled: !!userId && !useMock,
    queryFn: async () => {
      // 1. Get user's conversation participants entries
      const { data: participants, error: errorPart } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', userId);

      if (errorPart || !participants) return 0;

      let totalUnreads = 0;

      for (const p of participants) {
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .neq('sender_id', userId);

        if (p.last_read_at) {
          query = query.gt('created_at', p.last_read_at);
        }

        const { count, error } = await query;
        if (!error && count !== null) {
          totalUnreads += count;
        }
      }

      return totalUnreads;
    },
    refetchInterval: 1000 * 30
  });
}


// -----------------------------------------------------------------------------
// Messages Tab Component
// -----------------------------------------------------------------------------
interface MessagesTabProps {
  session: any;
  onUserPress: (id: string) => void;
  onPinPress: (pin: any) => void;
  initialChatId?: string | null;
}

export const MessagesTab: React.FC<MessagesTabProps> = ({ session, onUserPress, onPinPress, initialChatId }) => {
  const currentUserId = session?.user?.id;
  const [activeChat, setActiveChat] = useState<any>(null);
  const [activeCategory, setActiveCategory] = useState<'primary' | 'general' | 'requests'>('primary');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [userNoteText, setUserNoteText] = useState(localStorage.getItem('user_note_text') || 'First note in a while...');
  const [userNoteMusic, setUserNoteMusic] = useState(localStorage.getItem('user_note_music') || '');
  const [inputNoteText, setInputNoteText] = useState('');
  const [inputNoteMusic, setInputNoteMusic] = useState('');
  const queryClient = useQueryClient();

  // Dynamic current user profile for avatar integration
  const { data: myProfile } = useQuery({
    queryKey: ['my_profile', currentUserId],
    enabled: !!currentUserId && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUserId)
        .single();
      if (error) return null;
      return data;
    }
  });

  // Dynamic profiles list hook to load real-time active states/notes (removing mocked records)
  const { data: recentProfilesSim } = useQuery({
    queryKey: ['recent_profiles_notes', currentUserId],
    enabled: !!currentUserId && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, bio')
        .neq('id', currentUserId)
        .limit(12);
      if (error) {
        console.error("Error fetching profiles for notes:", error);
        return [];
      }
      return data || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const { data: conversations, isLoading, error: queryError } = useQuery({
    queryKey: ['conversations', currentUserId],
    enabled: !!currentUserId && !useMock,
    queryFn: async () => {
      // 1. Direct select matching BUG 2: Show all conversations where user1_id = myId OR user2_id = myId
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select(`
          id,
          conversation_type,
          title,
          created_by,
          last_message_at,
          user1_id,
          user2_id
        `)
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
        .order('last_message_at', { ascending: false });

      if (convErr) throw convErr;
      if (!convs || convs.length === 0) return [];

      const convIds = convs.map(c => c.id);

      // 2. Fetch other participants profiles in bulk
      const otherUserIds = convs.map(c => c.user1_id === currentUserId ? c.user2_id : c.user1_id).filter(Boolean);
      
      const { data: profiles, error: profErr } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .in('id', otherUserIds);

      if (profErr) throw profErr;

      // 3. Fetch last messages to display preview for each chat
      const { data: msgs, error: msgsErr } = await supabase
        .from('messages')
        .select('id, conversation_id, content, created_at, sender_id')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false });

      const mapped = convs.map(conv => {
        const otherId = conv.user1_id === currentUserId ? conv.user2_id : conv.user1_id;
        const otherProfile = profiles?.find(p => p.id === otherId) || null;
        const lastMsg = msgs?.find(m => m.conversation_id === conv.id) || null;
        return {
          ...conv,
          other_user: otherProfile,
          last_message: lastMsg
        };
      }).filter(c => c.other_user !== null);

      return mapped;
    },
    staleTime: 1000 * 5,
  });

  // Real-time subscription in MessagesTab to refresh the list in real-time
  useEffect(() => {
    if (!currentUserId) return;

    const channel1 = supabase
      .channel(`conv_list_ch1:${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: `user1_id=eq.${currentUserId}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
      })
      .subscribe();

    const channel2 = supabase
      .channel(`conv_list_ch2:${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversations',
        filter: `user2_id=eq.${currentUserId}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
      })
      .subscribe();

    const channelMessages = supabase
      .channel(`conv_list_messages:${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages'
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
        queryClient.invalidateQueries({ queryKey: ['unread_messages', currentUserId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel1);
      supabase.removeChannel(channel2);
      supabase.removeChannel(channelMessages);
    };
  }, [currentUserId, queryClient]);

  useEffect(() => {
    if (initialChatId && conversations) {
      const conv = conversations.find(c => c.id === initialChatId);
      if (conv) {
        setActiveChat(conv);
      } else {
        // Fetch explicitly if not in state
        const fetchExplicit = async () => {
          try {
            const { data: convData, error: convErr } = await supabase
              .from('conversations')
              .select('id, conversation_type, title, created_by, last_message_at, user1_id, user2_id')
              .eq('id', initialChatId)
              .maybeSingle();

            if (convData) {
              const otherId = convData.user1_id === currentUserId ? convData.user2_id : convData.user1_id;
              const { data: otherProfile } = await supabase
                .from('profiles')
                .select('id, username, full_name, avatar_url')
                .eq('id', otherId)
                .maybeSingle();

              setActiveChat({
                ...convData,
                other_user: otherProfile || null
              });
            }
          } catch (e) {
            console.error(e);
          }
        };
        fetchExplicit();
      }
    }
  }, [initialChatId, conversations, currentUserId]);

  const getOtherUser = (conv: any) => {
    return conv?.other_user;
  };

  const getConversationCategory = (conv: any, myId: string) => {
    const otherUser = conv.other_user;
    if (!otherUser) return 'primary';
    
    const isLocalBlocked = isUserBlockedByMe(myId, otherUser.id) || amIBlockedByThem(myId, otherUser.id);
    if (isLocalBlocked) {
      return 'requests';
    }
    
    return localStorage.getItem(`category:${conv.id}`) || 'primary';
  };

  const requestsCount = conversations?.filter(c => getConversationCategory(c, currentUserId) === 'requests').length || 0;
  
  // Filter conversations by category AND search terms
  const filteredConversations = conversations?.filter(c => {
    const isCategoryMatch = getConversationCategory(c, currentUserId) === activeCategory;
    if (!isCategoryMatch) return false;
    
    if (!searchTerm.trim()) return true;
    
    const otherUser = getOtherUser(c);
    if (!otherUser) return false;
    
    const term = searchTerm.toLowerCase();
    const username = (otherUser.username || '').toLowerCase();
    const fullName = (otherUser.full_name || '').toLowerCase();
    const nickname = (localStorage.getItem(`nickname:${c.id}`) || '').toLowerCase();
    
    return username.includes(term) || fullName.includes(term) || nickname.includes(term);
  }) || [];

  // Notes data formulation
  const handleOpenNoteModal = () => {
    setInputNoteText(userNoteText === 'First note in a while...' ? '' : userNoteText);
    setInputNoteMusic(userNoteMusic);
    setShowNoteModal(true);
  };

  const handleSaveNote = () => {
    const newText = inputNoteText.trim() || 'First note in a while...';
    const newMusic = inputNoteMusic.trim();
    setUserNoteText(newText);
    setUserNoteMusic(newMusic);
    localStorage.setItem('user_note_text', newText);
    localStorage.setItem('user_note_music', newMusic);
    setShowNoteModal(false);
  };

  const other = activeChat ? getOtherUser(activeChat) : null;

  return (
    <div className="flex h-[calc(100dvh-60px-env(safe-area-inset-bottom))] md:h-screen bg-black text-white select-none overflow-hidden relative w-full">
      {/* 1. Left Sidebar: List of Conversations, Categories and Notes */}
      <div className={`w-full md:w-[350px] lg:w-[380px] flex flex-col h-full bg-black border-r border-white/5 shrink-0 ${activeChat ? 'hidden md:flex' : 'flex'}`}>
        
        {/* Sidebar Header */}
        <div className="p-4 pb-2 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-1.5 cursor-pointer hover:opacity-85 select-none" onClick={handleOpenNoteModal}>
            <span className="text-white text-[15px] font-extrabold tracking-tight truncate max-w-[140px] md:max-w-[180px]">
              {session?.user?.user_metadata?.username || session?.user?.email?.split('@')[0] || 'ermaxamadov.sardor'}
            </span>
            <span className="inline-flex items-center justify-center bg-[#0095f6] text-white rounded-full w-4 h-4 shrink-0 font-bold text-[8px]">
              ✓
            </span>
            <ChevronRight size={14} className="text-neutral-400 rotate-90 shrink-0" />
          </div>
          
          <button onClick={handleOpenNoteModal} className="p-2 rounded-full text-neutral-200 hover:bg-neutral-900 transition-colors shrink-0">
            <Edit2 size={16} />
          </button>
        </div>

        {/* Sub Category Tabs (Primary, General, Requests) */}
        <div className="flex border-b border-white/5 select-none text-xs font-semibold px-2">
          <button
            onClick={() => setActiveCategory('primary')}
            className={`flex-1 text-center py-3 transition-all relative ${
              activeCategory === 'primary' 
                ? 'text-white font-bold' 
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <span>Primary</span>
            {activeCategory === 'primary' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
          </button>
          <button
            onClick={() => setActiveCategory('general')}
            className={`flex-1 text-center py-3 transition-all relative ${
              activeCategory === 'general' 
                ? 'text-white font-bold' 
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <span>General</span>
            {activeCategory === 'general' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
          </button>
          <button
            onClick={() => setActiveCategory('requests')}
            className={`flex-1 text-center py-3 transition-all relative ${
              activeCategory === 'requests' 
                ? 'text-white font-bold font-semibold' 
                : 'text-neutral-500 hover:text-neutral-350'
            }`}
          >
            <span>Requests</span>
            {requestsCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[8px] bg-red-650 text-white rounded-full leading-none font-bold">
                {requestsCount}
              </span>
            )}
            {activeCategory === 'requests' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white" />}
          </button>
        </div>

        {/* Search Input Bar */}
        <div className="px-3.5 py-2.5">
          <div className="relative flex items-center bg-[#1c1c1e] text-neutral-400 rounded-xl px-3 py-2 w-full border border-white/5">
            <Search size={14} className="mr-2 text-neutral-500 shrink-0" />
            <input 
              type="text" 
              placeholder="Search" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-transparent border-none outline-none text-neutral-200 text-xs w-full placeholder-neutral-500"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="p-0.5 rounded-full hover:bg-neutral-800 text-neutral-400 shrink-0">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Notes Segment row (horizontal carousel of active states) */}
        {!searchTerm && (
          <div className="px-4 border-b border-white/5 bg-black/40">
            <div className="flex items-center gap-5 overflow-x-auto no-scrollbar scroll-smooth pt-8 pb-3">
              
              {/* Note item: Me */}
              <div className="flex flex-col items-center shrink-0 w-16 relative cursor-pointer group" onClick={handleOpenNoteModal}>
                <div className="relative mb-2">
                  {/* Current profile Avatar */}
                  {myProfile?.avatar_url ? (
                    <S3Image 
                      src={myProfile.avatar_url} 
                      className="w-12 h-12 rounded-full object-cover border border-neutral-800 shadow group-hover:border-neutral-500 transition-all duration-300"
                      skeletonClassName="rounded-full"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-neutral-800 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-400 group-hover:border-neutral-500 transition-all duration-300">
                      <User size={18} />
                    </div>
                  )}
                  {/* Plus create button trigger overlay */}
                  <div className="absolute -bottom-1 -right-1 bg-[#121214] border border-white/10 rounded-full p-0.5 text-white/90">
                    <Plus size={10} className="stroke-[3]" />
                  </div>
                  
                  {/* Speech bubble thought overlay */}
                  <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-neutral-850 border border-white/5 px-2 py-0.5 rounded-xl shadow-lg w-[76px] text-center select-none z-10 font-sans group-hover:scale-105 transition-transform">
                    <p className="text-[7.5px] text-neutral-200 leading-tight truncate font-medium">
                      {userNoteMusic ? `🎵 ${userNoteMusic}` : userNoteText}
                    </p>
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-neutral-850 border-r border-b border-white/5 rotate-45" />
                  </div>
                </div>
                <span className="text-[10px] text-neutral-400 font-medium truncate w-full text-center group-hover:text-white transition-colors">Your note</span>
              </div>

              {/* Dynamic Profiles notes selection list */}
              {recentProfilesSim?.map((prof: any) => {
                const hasBio = prof.bio && prof.bio.trim().length > 0;
                const statusList = [
                  "Active 🟢", "Suhbatlashamiz! 💬", "Online ✨", 
                  "Ready to chat 🚀", "Working 💼", "In a meeting 🤫"
                ];
                const seedIndex = prof.id ? Math.abs(prof.id.charCodeAt(0) + prof.id.charCodeAt(prof.id.length - 1)) % statusList.length : 0;
                const activeNote = hasBio ? prof.bio : statusList[seedIndex];
                const displayOtherAvatar = prof.avatar_url || '';

                return (
                  <div 
                    key={prof.id} 
                    className="flex flex-col items-center shrink-0 w-16 relative cursor-pointer group"
                    onClick={async () => {
                      try {
                        const convId = await findOrCreateConversation(currentUserId, prof.id);
                        queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
                        setActiveChat({
                          id: convId,
                          conversation_type: 'direct',
                          user1_id: currentUserId < prof.id ? currentUserId : prof.id,
                          user2_id: currentUserId > prof.id ? currentUserId : prof.id,
                          other_user: prof
                        });
                      } catch (err) {
                        console.error('Error opening conversation from note:', err);
                      }
                    }}
                  >
                    <div className="relative mb-2">
                      {displayOtherAvatar ? (
                        <S3Image 
                          src={displayOtherAvatar} 
                          className="w-12 h-12 rounded-full object-cover border border-neutral-800 shadow group-hover:border-neutral-500 transition-all duration-300"
                          skeletonClassName="rounded-full"
                        />
                      ) : (
                        <div className="w-12 h-12 bg-neutral-800 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-400 group-hover:border-neutral-500 transition-all duration-300">
                          <User size={18} />
                        </div>
                      )}
                      
                      {/* Active green status light */}
                      <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-black rounded-full" />
                      
                      {/* Speech bubble note overlay */}
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-neutral-850 border border-white/5 px-2 py-0.5 rounded-xl shadow-lg w-[76px] text-center select-none z-10 font-sans group-hover:scale-105 transition-transform">
                        <p className="text-[7.5px] text-neutral-200 leading-tight truncate font-semibold">
                          {activeNote}
                        </p>
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-neutral-850 border-r border-b border-white/5 rotate-45" />
                      </div>
                    </div>
                    <span className="text-[10px] text-neutral-400 font-medium truncate w-full text-center group-hover:text-white transition-colors">
                      {prof.full_name || prof.username || 'User'}
                    </span>
                  </div>
                );
              })}

            </div>
          </div>
        )}

        {/* Conversation list core scrollable zone */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
          {queryError ? (
            <DatabaseSyncAlert error={queryError} />
          ) : isLoading ? (
            <div className="flex justify-center mt-12 py-10">
              <div className="w-7 h-7 rounded-full border-2 border-neutral-800 border-t-[#E60023] animate-spin" />
            </div>
          ) : (
            <>
              {filteredConversations.map((conv) => {
                const otherUser = getOtherUser(conv);
                if (!otherUser) return null;

                const isLocalBlocked = isBlockedEitherWay(currentUserId, otherUser.id);
                const isActiveSel = activeChat?.id === conv.id;

                const displayListAvatar = isLocalBlocked
                  ? ""
                  : (otherUser.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100');

                const nickname = localStorage.getItem(`nickname:${conv.id}`) || otherUser.full_name || otherUser.username;
                
                // Content preview parser
                let previewText = 'Suhbatni ochish...';
                if (conv.last_message) {
                  const parsed = parseMessage(conv.last_message);
                  previewText = parsed.is_deleted 
                    ? "Bu xabar o'chirildi" 
                    : (conv.last_message.content.startsWith('[PIN_SHARE:') ? 'Ulashilgan post 🖼️' : parsed.textContent);
                }

                return (
                  <div 
                    key={conv.id} 
                    onClick={() => setActiveChat(conv)}
                    className={`flex items-center gap-4 p-3.5 mx-2 rounded-2xl cursor-pointer transition-all active:scale-98 relative duration-150 ${
                      isActiveSel 
                        ? 'bg-[#18181b] border border-white/5 shadow-lg scale-[1.01]' 
                        : 'bg-transparent hover:bg-neutral-900/30 border border-transparent'
                    }`}
                  >
                    <div className="relative shrink-0">
                      {displayListAvatar ? (
                        <div className="relative">
                          <S3Image 
                            src={displayListAvatar} 
                            className="w-[44px] h-[44px] rounded-full object-cover border border-neutral-900 shadow-md" 
                            skeletonClassName="rounded-full"
                          />
                        </div>
                      ) : (
                        <div className="w-[44px] h-[44px] bg-neutral-800 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-400">
                          <User size={18} />
                        </div>
                      )}
                      {!isLocalBlocked && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-black rounded-full" />}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center justify-between">
                        <h4 className="text-white text-[13px] font-bold truncate pr-3 flex items-center gap-1 font-sans">
                          <span className="truncate">{nickname}</span>
                          {isLocalBlocked && (
                            <span className="text-[7px] bg-red-500/10 text-[#E60023] px-1 rounded uppercase font-black shrink-0 font-sans">Blocked</span>
                          )}
                        </h4>
                        {conv.last_message && (
                          <span className="text-[10px] text-neutral-500 shrink-0 font-medium">
                            {formatDistanceToNow(new Date(conv.last_message.created_at), { addSuffix: false })
                              .replace('about ', '')
                              .replace('less than a minute', 'now')
                              .replace('minute', 'm')
                              .replace('minutes', 'm')
                              .replace('hours', 'h')
                              .replace('hour', 'h')
                              .replace('days', 'd')
                              .replace('day', 'd')
                              .replace('months', 'mo')
                              .replace('ago', '')}
                          </span>
                        )}
                      </div>
                      <p className="text-neutral-400 text-[11.5px] truncate mt-0.5 max-w-[220px]">
                        {previewText}
                      </p>
                    </div>
                  </div>
                );
              })}
              
              {filteredConversations.length === 0 && (
                <div className="text-neutral-500 text-center py-16 px-4 select-none">
                  <MessageCircle size={32} className="mx-auto mb-3 opacity-20 text-neutral-500" />
                  <p className="text-xs font-bold text-neutral-450">Suhbat topilmadi</p>
                  <p className="text-[10px] text-neutral-600 mt-1">Suhbatlarni boshlash uchun boshqa foydalanuvchilar profiliga tashrif buyuring.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 2. Right Pane: Chat Window or Instagram Direct Style Empty State Placeholder */}
      <div className={`flex-1 flex flex-col h-full bg-[#0d0d0e] ${activeChat ? 'flex' : 'hidden md:flex'}`}>
        {activeChat ? (
          <ChatView 
            conversation={activeChat} 
            session={session} 
            onBack={() => setActiveChat(null)} 
            otherUser={other || { id: '', username: 'User', avatar_url: '' }} 
            onUserPress={onUserPress} 
            onPinPress={onPinPress}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 select-none bg-black text-center">
            <div className="w-24 h-24 rounded-full border-2 border-white/10 flex items-center justify-center mb-5 bg-neutral-900 border border-white/5 shadow-inner">
              {/* Instagram direct paperplane / messaging envelope icon represent */}
              <Send size={38} className="-rotate-12 translate-x-1.5 -translate-y-0.5 text-white/95" />
            </div>
            <h3 className="text-white text-xl font-bold tracking-tight">Your messages</h3>
            <p className="text-neutral-450 text-xs mt-1.5 max-w-sm leading-relaxed">
              Send a message to start a chat.
            </p>
            <button 
              onClick={() => {
                // If there are conversations, select the first one! Or inform user
                if (conversations && conversations.length > 0) {
                  setActiveChat(conversations[0]);
                } else {
                  alert("Suhbat boshlash uchun boshqa profillar sahifasiga o'ting va 'Xabar jo'natish' tugmasini bosing!");
                }
              }} 
              className="mt-6 bg-[#0095f6] hover:bg-[#1885f2] active:scale-95 transition-all text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg"
            >
              Send message
            </button>
          </div>
        )}
      </div>

      {/* 3. Thought note customization modal */}
      <AnimatePresence>
        {showNoteModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#121214] border border-white/5 w-full max-w-sm rounded-[24px] overflow-hidden p-6 shadow-2xl text-left"
            >
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
                <span className="text-white text-sm font-bold">New Thought Note ✍️</span>
                <button onClick={() => setShowNoteModal(false)} className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-neutral-400 font-bold uppercase tracking-wider mb-1.5">What is on your mind? (Max 60 chars)</label>
                  <textarea
                    rows={2}
                    maxLength={60}
                    value={inputNoteText}
                    onChange={(e) => setInputNoteText(e.target.value)}
                    placeholder="Enter what you're thinking right now..."
                    className="w-full bg-neutral-900 border border-white/5 p-3 rounded-xl text-xs text-[#fff] outline-none focus:border-white/25 placeholder-neutral-600 resize-none font-medium text-left"
                  />
                  <div className="text-right text-[9px] text-neutral-500 font-bold mt-1">
                    {60 - inputNoteText.length} characters remaining
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 font-bold uppercase tracking-wider mb-1.5">What are you listening to? (Song, optional)</label>
                  <div className="relative flex items-center bg-neutral-900 border border-white/5 rounded-xl px-3 py-2 w-full">
                    <Music size={13} className="mr-2 text-neutral-500 shrink-0" />
                    <input 
                      type="text" 
                      value={inputNoteMusic}
                      onChange={(e) => setInputNoteMusic(e.target.value)}
                      placeholder="e.g. West Coast - Lana Del Rey"
                      className="bg-transparent border-none outline-none text-neutral-200 text-xs w-full placeholder-neutral-600 font-medium text-left"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button 
                    onClick={() => setShowNoteModal(false)}
                    className="flex-1 border border-white/10 hover:bg-white/5 text-neutral-300 font-bold text-xs py-2.5 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSaveNote}
                    className="flex-1 bg-[#0095f6] hover:bg-[#1885f2] text-white font-bold text-xs py-2.5 rounded-xl transition-colors"
                  >
                    Share Note
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};


// -----------------------------------------------------------------------------
// Active Chat View Window
// -----------------------------------------------------------------------------
interface ChatViewProps {
  conversation: any;
  session: any;
  onBack: () => void;
  otherUser: any;
  onUserPress: (id: string) => void;
  onPinPress: (pin: any) => void;
}

// Giphy quick loading tag categories constant
const QUICK_GIPHY_TAGS = ['Salom', 'Rahmat', 'Lol', 'Wow', 'Sevgi', 'Kulgi', 'Tabrik', 'Ok'];

const ChatView: React.FC<ChatViewProps> = ({ conversation, session, onBack, otherUser, onUserPress, onPinPress }) => {
  const currentUserId = session?.user?.id;
  const queryClient = useQueryClient();
  
  // General states
  const [text, setText] = useState('');
  const [showOptions, setShowOptions] = useState(false);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [nickname, setNickname] = useState<string>(() => {
    return localStorage.getItem(`nickname:${conversation.id}`) || '';
  });

  // Photo & upload states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImg, setUploadingImg] = useState(false);

  // Giphy states
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [giphyGifs, setGiphyGifs] = useState<any[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

  // Active contextual menu for reactions/replies/edit/delete
  const [activeCtxOptionMsg, setActiveCtxOptionMsg] = useState<any | null>(null);

  // Draft flags
  const [replyToDraft, setReplyToDraft] = useState<{ id: string; senderName: string; text: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);

  // View full screen image
  const [showFullImage, setShowFullImage] = useState<string | null>(null);

  // Scrolling ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper: Giphy fetcher
  const fetchGiphyGifs = async (query: string): Promise<any[]> => {
    const apiKey = import.meta.env.VITE_GIPHY_API_KEY || 'A7KiZNIpEk8FqkH5ZtbVhcTpxOxNX62j';
    const limit = 24;
    const rating = 'g';
    const url = query.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${limit}&rating=${rating}`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=${limit}&rating=${rating}`;
    try {
      const res = await fetch(url);
      const json = await res.json();
      return json.data || [];
    } catch (err) {
      console.error('Giphy Fetch error:', err);
      return [];
    }
  };

  // Debounced Giphy Load
  useEffect(() => {
    if (!showGifPicker) return;

    let active = true;
    const loadGifs = async () => {
      setLoadingGifs(true);
      const items = await fetchGiphyGifs(gifQuery);
      if (active) {
        setGiphyGifs(items);
        setLoadingGifs(false);
      }
    };

    const timer = setTimeout(() => {
      loadGifs();
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [gifQuery, showGifPicker]);

  // Fetch Other Participant's real-time live profile data
  const { data: liveOtherUser } = useQuery({
    queryKey: ['chat_other_profile', otherUser.id],
    enabled: !!otherUser.id && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url')
        .eq('id', otherUser.id)
        .single();
      if (error) throw error;
      return data;
    },
    initialData: otherUser,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch Other Participant's last_read_at
  const { data: otherPart } = useQuery({
    queryKey: ['other_participant', conversation.id, otherUser.id],
    enabled: !!conversation.id && !!otherUser.id && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('last_read_at')
        .eq('conversation_id', conversation.id)
        .eq('user_id', otherUser.id)
        .maybeSingle();
      return data || null;
    },
    refetchInterval: 3000,
  });

  // Fetch messages for this conversation
  const { data: messages, isLoading, error: msgsError } = useQuery({
    queryKey: ['messages', conversation.id],
    enabled: !!conversation.id && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select(`
          id,
          content,
          sender_id,
          message_type,
          image_url,
          shared_pin_id,
          is_read,
          created_at,
          profiles!sender_id(
            id,
            username,
            avatar_url
          )
        `)
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      
      try {
        await supabase
          .from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', conversation.id)
          .eq('user_id', currentUserId);
        
        queryClient.invalidateQueries({ queryKey: ['unread_messages', currentUserId] });
      } catch (e) {
        console.error('last_read_at update error:', e);
      }
      return data || [];
    },
    refetchInterval: 3000,
  });

  // Real-time subscription for messages
  useEffect(() => {
    if (!conversation.id) return;

    const channel = supabase
      .channel(`chat_messages:${conversation.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversation.id}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
        queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, queryClient, currentUserId]);

  // Scrolling Down handling
  const scrollToBottom = (behavior: 'smooth' | 'auto' = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
  };

  useEffect(() => {
    scrollToBottom('auto');
  }, [conversation.id]);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages?.length]);

  // Core insertion mutation
  const sendMutation = useMutation({
    mutationFn: async (payload: { content: string; message_type?: string; image_url?: string }) => {
      const { error } = await supabase.from('messages').insert({
        conversation_id: conversation.id,
        sender_id: currentUserId,
        content: payload.content,
        message_type: payload.message_type || 'text',
        image_url: payload.image_url || null
      });
      if (error) throw error;
      
      try {
        await supabase
          .from('conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', conversation.id);
      } catch (e) {
        console.error('last_message_at update error:', e);
      }
    },
    onSuccess: () => {
      setText('');
      setReplyToDraft(null);
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
      setTimeout(() => scrollToBottom('smooth'), 100);
    }
  });

  // Block mutation
  const blockMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('blocked_users')
        .insert({
          blocker_id: currentUserId,
          blocked_id: liveOtherUser.id
        });
      if (error && error.code !== '23505') throw error;
    },
    onSuccess: () => {
      alert("User blocked successfully.");
      onBack();
    },
    onError: (err: any) => {
      alert("Failed to block user: " + err.message);
    }
  });

  // Submit new text message
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    if (editingMessage) {
      handleSaveEdit(editingMessage.id, text.trim());
      return;
    }

    const isRich = !!replyToDraft;
    let finalContent = text.trim();

    if (isRich) {
      finalContent = JSON.stringify({
        _isRich: true,
        text: text.trim(),
        replyTo: replyToDraft ? {
          id: replyToDraft.id,
          senderName: replyToDraft.senderName,
          text: replyToDraft.text
        } : undefined,
        reactions: []
      });
    }

    sendMutation.mutate({ content: finalContent, message_type: 'text' });
  };

  // Toggle/add Emojis on custom reactions
  const handleToggleReaction = async (messageId: string, emoji: string) => {
    const msgObj = messages?.find((m: any) => m.id === messageId);
    if (!msgObj) return;

    const { isRich, textContent, replyTo, reactions, is_edited, is_deleted } = parseMessage(msgObj);
    let updatedReactions = [...(reactions || [])];
    const existingReactionIdx = updatedReactions.findIndex(r => r.emoji === emoji);

    if (existingReactionIdx > -1) {
      const existing = updatedReactions[existingReactionIdx];
      if (existing.userIds.includes(currentUserId)) {
        // Remove reaction
        existing.userIds = existing.userIds.filter((uid: string) => uid !== currentUserId);
      } else {
        // Add reaction
        existing.userIds.push(currentUserId);
      }
    } else {
      // Add reaction
      updatedReactions.push({
        emoji,
        userIds: [currentUserId]
      });
    }

    // Filter empty
    updatedReactions = updatedReactions.filter(r => r.userIds.length > 0);

    const richContentObj = {
      _isRich: true,
      text: textContent,
      replyTo: replyTo || undefined,
      reactions: updatedReactions,
      is_edited,
      is_deleted
    };

    const { error } = await supabase
      .from('messages')
      .update({ content: JSON.stringify(richContentObj) })
      .eq('id', messageId);

    if (error) {
      console.error('Failed to update reaction:', error);
    } else {
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
    }
    setActiveCtxOptionMsg(null);
  };

  // Save changes on Edited text
  const handleSaveEdit = async (messageId: string, newText: string) => {
    const msgObj = messages?.find((m: any) => m.id === messageId);
    if (!msgObj) return;

    const { replyTo, reactions } = parseMessage(msgObj);
    const richContentObj = {
      _isRich: true,
      text: newText,
      replyTo: replyTo || undefined,
      reactions: reactions || [],
      is_edited: true
    };

    const { error } = await supabase
      .from('messages')
      .update({ 
        content: JSON.stringify(richContentObj)
      })
      .eq('id', messageId);

    if (error) {
      console.error('Failed to update edit message:', error);
    } else {
      setEditingMessage(null);
      setText('');
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
    }
  };

  // WhatsApp / Instagram style soft delete
  const handleDeleteMessage = async (messageId: string) => {
    const msgObj = messages?.find((m: any) => m.id === messageId);
    let originalText = '';
    if (msgObj) {
      const parsed = parseMessage(msgObj);
      originalText = parsed.textContent;
    }

    const richContentObj = {
      _isRich: true,
      text: "Bu xabar o'chirildi",
      is_deleted: true,
      reactions: [],
      replyTo: null
    };

    const { error } = await supabase
      .from('messages')
      .update({
        content: JSON.stringify(richContentObj)
      })
      .eq('id', messageId);

    if (error) {
      console.error('Failed to update soft delete:', error);
    } else {
      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
    }
    setActiveCtxOptionMsg(null);
  };

  // S3 Image uploads triggers
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadingImg(true);
      const fileExt = file.name.split('.').pop() || 'png';
      const filePath = `chats/${conversation.id}/${Date.now()}_img.${fileExt}`;
      
      const s3Url = await uploadToS3(file, filePath);

      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        sender_id: currentUserId,
        content: `[Ovozli yoki Rasmli Xabar]`,// backup label
        message_type: 'image',
        image_url: s3Url
      });

      // update last message at
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);

      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
    } catch (err: any) {
      alert("Rasmni yuklashda xatolik yuz berdi: " + err.message);
    } finally {
      setUploadingImg(false);
    }
  };

  // Handle selected Giphy GIF
  const handleGifSelect = async (gifUrl: string) => {
    try {
      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        sender_id: currentUserId,
        content: `[Ovozli yoki Rasmli Xabar]`,// backup content label
        message_type: 'gif',
        image_url: gifUrl
      });

      // update last message at
      await supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversation.id);

      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
      queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
      setShowGifPicker(false);
    } catch (err: any) {
      alert("GIF jo'natishda xatolik: " + err.message);
    }
  };

  const isBlockedMeToThem = isUserBlockedByMe(currentUserId, liveOtherUser.id);
  const isBlockedThemToMe = amIBlockedByThem(currentUserId, liveOtherUser.id);
  const isBlockedEither = isBlockedMeToThem || isBlockedThemToMe;

  const displayOtherAvatarUrl = isBlockedEither
    ? ""
    : (liveOtherUser.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100');

  return (
    <motion.div 
      initial={{ opacity: 0, x: 25 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: 25 }} 
      className="fixed inset-x-0 top-0 bottom-[calc(60px+env(safe-area-inset-bottom))] md:relative md:inset-auto md:max-w-none md:shadow-none z-20 md:z-10 flex flex-col bg-black h-[calc(100dvh-60px-env(safe-area-inset-bottom))] md:h-full w-full overflow-hidden"
    >
      {/* Top Banner Navigation Header */}
      <div className="sticky top-0 bg-[#0c0c0d]/90 backdrop-blur-md border-b border-white/5 p-4 pt-10 md:pt-4 flex items-center gap-4 z-20 select-none">
        <button onClick={onBack} className="p-2.5 bg-white/5 hover:bg-white/10 active:scale-95 text-white rounded-full flex items-center justify-center transition-all md:hidden">
          <ChevronLeft size={20} />
        </button>
        
        <div 
          onClick={() => setShowOptions(true)}
          className="flex items-center gap-3 flex-1 cursor-pointer group text-left"
        >
          <div className="relative">
            {displayOtherAvatarUrl ? (
              <S3Image 
                src={displayOtherAvatarUrl} 
                className="w-10 h-10 rounded-full object-cover shrink-0 border border-neutral-800 group-hover:border-neutral-500 transition-all shadow-md" 
                skeletonClassName="rounded-full"
              />
            ) : (
              <div className="w-10 h-10 bg-neutral-800 flex items-center justify-center rounded-full border border-neutral-700 text-neutral-400 group-hover:border-neutral-500 transition-all shadow-md">
                <User size={18} />
              </div>
            )}
            {!isBlockedEither && <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#0c0c0d] rounded-full shadow-sm animate-pulse" />}
          </div>
          <div>
            <h3 className="text-white font-bold text-sm tracking-tight leading-none flex items-center gap-1.5 hover:text-neutral-200 transition-colors">
              <span>{nickname || liveOtherUser.full_name || liveOtherUser.username}</span>
              {!isBlockedEither ? (
                <span className="text-[9px] bg-red-500/10 text-red-500 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">online</span>
              ) : (
                <span className="text-[9px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">bloklangan</span>
              )}
            </h3>
            <p className="text-[10px] text-neutral-400 mt-1">
              {isBlockedEither ? "ko'p vaqt oldin faol bo'lgan" : "Suhbat sozlamalari"}
            </p>
          </div>
        </div>

        <button 
          onClick={() => setShowOptions(true)} 
          className="p-2.5 bg-white/5 hover:bg-white/10 active:scale-95 text-white rounded-full flex items-center justify-center transition-all"
        >
          <MoreVertical size={18} />
        </button>
      </div>

      {/* Main Messages scroll frame */}
      <div className="flex-1 overflow-y-auto px-4 pt-6 pb-20 space-y-5 flex flex-col no-scrollbar bg-gradient-to-b from-[#0b0b0b] via-[#0d0d0f] to-[#0a0a0a]">
        {msgsError ? (
          <DatabaseSyncAlert error={msgsError} />
        ) : messages?.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center select-none opacity-40">
            <MessageCircle size={54} className="text-[#E60023] mb-3 animate-pulse" />
            <p className="text-white text-xs font-semibold">Hech qanday xabarlar yo'q</p>
            <p className="text-[11px] text-neutral-500 mt-1 max-w-[200px]">Bu yerda xavfsiz va shifrlangan muloqot boshlashingiz mumkin.</p>
          </div>
        ) : (
          messages?.map((m: any) => {
            const isMine = m.sender_id === currentUserId;
            const isSeen = otherPart?.last_read_at && new Date(m.created_at) <= new Date(otherPart.last_read_at);
            const isSystemPinMatch = m.content?.match(/^\[PIN_SHARE:(.+)\]$/);

            // Parse rich info
            const { isRich, textContent, replyTo, reactions, is_edited, is_deleted } = parseMessage(m);

            if (isSystemPinMatch) {
              const pinId = isSystemPinMatch[1];
              return (
                <motion.div 
                  key={m.id} 
                  initial={{ opacity: 0, scale: 0.9, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 350, damping: 25 }}
                  layout
                  className={`max-w-[80%] rounded-3xl flex flex-col gap-1 ${isMine ? 'self-end' : 'self-start'}`}
                >
                  <SharedPinMessage pinId={pinId} onPinPress={onPinPress} />
                  <div className="flex items-center gap-1 justify-end px-2 text-[9px] text-neutral-500">
                    <span>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</span>
                    {isMine && (isSeen ? <CheckCheck size={12} className="text-red-500" /> : <Check size={12} />)}
                  </div>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 15, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 450, damping: 30 }}
                layout
                className={`flex gap-2.5 max-w-[85%] group relative ${isMine ? 'self-end flex-row-reverse' : 'self-start'}`}
              >
                {/* Receiver side Avatar */}
                {!isMine && (
                  displayOtherAvatarUrl ? (
                    <S3Image 
                      src={displayOtherAvatarUrl} 
                      className="w-7 h-7 rounded-full object-cover border border-[#1c1c1f] shrink-0 self-end mb-1 shadow-sm transition-all"
                      skeletonClassName="rounded-full"
                    />
                  ) : (
                    <div className="w-7 h-7 bg-neutral-800 flex items-center justify-center rounded-full border border-white/5 text-neutral-400 shrink-0 self-end mb-1 shadow-sm transition-all">
                      <User size={13} />
                    </div>
                  )
                )}

                <div className="flex flex-col">
                  {/* Bubble body wrapper */}
                  <div 
                    onClick={() => {
                      if (!is_deleted) {
                        setActiveCtxOptionMsg(m);
                      }
                    }}
                    className={`px-4 py-3 cursor-pointer select-none transition-all duration-150 relative ${
                      is_deleted
                        ? 'bg-neutral-900/40 border border-white/5 text-neutral-500 text-xs italic self-start rounded-[20px] rounded-tl-[4px]'
                        : isMine 
                          ? 'bg-[#E60023] text-white self-end rounded-[22px] rounded-tr-[6px] shadow-sm hover:brightness-105 active:scale-[0.98]' 
                          : 'bg-[#1c1c1f] border border-white/5 text-white self-start rounded-[22px] rounded-tl-[6px] hover:brightness-105 active:scale-[0.98]'
                    }`}
                  >
                    {/* Render Replies banner parent inside bubble */}
                    {!is_deleted && replyTo && (
                      <div className={`p-2 rounded-xl text-xs mb-2 border-l-2 text-left truncate max-w-[260px] ${
                        isMine 
                          ? 'bg-black/25 border-white/60 text-white/90' 
                          : 'bg-neutral-950 border-[#E60023] text-neutral-300'
                      }`}>
                        <p className="font-bold text-[10px] opacity-80">{replyTo.senderName}</p>
                        <p className="truncate text-[11px] opacity-90">{replyTo.text}</p>
                      </div>
                    )}

                    {/* Rich text or standard file representations */}
                    {is_deleted ? (
                      <p className="leading-snug text-left">{textContent}</p>
                    ) : m.message_type === 'image' ? (
                      <div className="relative rounded-xl overflow-hidden shadow border border-white/5 bg-neutral-950">
                        <S3Image 
                          src={m.image_url} 
                          className="max-w-[240px] max-h-56 object-cover rounded-xl cursor-zoom-in hover:scale-101 transition-transform" 
                          skeletonClassName="rounded-xl"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowFullImage(m.image_url);
                          }}
                        />
                      </div>
                    ) : m.message_type === 'gif' ? (
                      <div className="relative rounded-xl overflow-hidden shadow bg-neutral-950 border border-white/5">
                        <img 
                          src={m.image_url} 
                          alt="Giphy Animation" 
                          className="max-w-[240px] max-h-52 object-cover rounded-xl cursor-pointer"
                          referrerPolicy="no-referrer"
                          onClick={() => {
                            setShowFullImage(m.image_url);
                          }}
                        />
                      </div>
                    ) : (
                      <p className="text-[13.5px] leading-relaxed break-words text-left font-normal tracking-wide">
                        {textContent}
                      </p>
                    )}

                    {/* Text indicators */}
                    {!is_deleted && (
                      <div className={`flex items-center gap-1 justify-end mt-1 text-[8.5px] select-none font-medium ${isMine ? 'text-red-200' : 'text-neutral-500'}`}>
                        {is_edited && <span className="italic mr-1 text-[8px] opacity-70">tahrirlangan</span>}
                        <span>{formatDistanceToNow(new Date(m.created_at), { addSuffix: false })
                          .replace('about ', '')
                          .replace('less than a minute', 'now')
                          .replace('minute', 'm')
                          .replace('minutes', 'm')
                          .replace('hours', 'h')
                          .replace('hour', 'h')
                          .replace('days', 'd')
                          .replace('day', 'd')
                          .replace('ago', '')}</span>
                        {isMine && (isSeen ? (
                          <CheckCheck size={11} className="text-white/80 shrink-0" />
                        ) : (
                          <Check size={11} className="text-white/40 shrink-0" />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Render encapsulated emoji reactions pill underneath */}
                  {!is_deleted && reactions && reactions.length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : 'justify-start'}`}>
                      {reactions.map((r: any, rIdx: number) => {
                        const hasWeReacted = r.userIds.includes(currentUserId);
                        return (
                          <motion.button
                            whileTap={{ scale: 0.8 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleReaction(m.id, r.emoji);
                            }}
                            key={rIdx}
                            className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold backdrop-blur border shadow-sm transition-colors ${
                              hasWeReacted 
                                ? 'bg-red-500/15 border-[#E60023]/30 text-[#E60023]' 
                                : 'bg-[#1c1c1f]/80 border-white/5 text-neutral-300 hover:bg-neutral-800'
                            }`}
                          >
                            <span>{r.emoji}</span>
                            {r.userIds.length > 1 && <span className="text-[9px] opacity-80 ml-0.5">{r.userIds.length}</span>}
                          </motion.button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Media loader overlay */}
      {uploadingImg && (
        <div className="bg-neutral-950/70 border-t border-neutral-900/50 p-2 flex items-center justify-center gap-2 text-xs text-neutral-400 select-none animate-pulse">
          <Loader2 size={14} className="text-red-500 animate-spin" />
          <span>Rasm yuklanmoqda. Iltimos kuting...</span>
        </div>
      )}

      {/* Reply Draft view container banner */}
      {replyToDraft && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: 'auto' }} 
          exit={{ opacity: 0, height: 0 }} 
          className="bg-[#121214] border-t border-neutral-900 p-2 px-4 flex items-center justify-between text-left"
        >
          <div className="border-l-2 border-[#E60023] pl-2 overflow-hidden max-w-[340px]">
            <p className="text-[10px] uppercase font-extrabold text-red-500">Javob berilmoqda • {replyToDraft.senderName}</p>
            <p className="text-xs text-neutral-400 truncate mt-0.5">{replyToDraft.text}</p>
          </div>
          <button 
            type="button" 
            onClick={() => setReplyToDraft(null)} 
            className="p-1.5 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white"
          >
            <X size={15} />
          </button>
        </motion.div>
      )}

      {/* Editing State notification banner */}
      {editingMessage && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }} 
          animate={{ opacity: 1, height: 'auto' }} 
          exit={{ opacity: 0, height: 0 }} 
          className="bg-neutral-900/90 border-t border-[#E60023]/20 p-2 px-4 flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-1.5">
            <Edit2 size={13} className="text-red-500" />
            <p className="text-[11px] font-bold text-neutral-300">Suhbat tahrirlanmoqda...</p>
          </div>
          <button 
            type="button" 
            onClick={() => {
              setEditingMessage(null);
              setText('');
            }} 
            className="px-2.5 py-1 bg-neutral-800 hover:bg-[#E60023] rounded-full text-[9px] font-bold text-white uppercase transition-colors"
          >
            Bekor qilish
          </button>
        </motion.div>
      )}

      {/* Floating active Giphy Picker Drawer screen view */}
      <AnimatePresence>
        {showGifPicker && (
          <motion.div 
            initial={{ y: '100%' }} 
            animate={{ y: 0 }} 
            exit={{ y: '100%' }} 
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="absolute inset-x-0 bottom-0 z-30 bg-[#0e0e0f] rounded-t-3xl border-t border-white/5 flex flex-col h-[65%] max-w-lg mx-auto shadow-2xl"
          >
            {/* Drawer top notch line */}
            <div className="h-1.5 w-12 bg-neutral-800 rounded-full mx-auto mt-3 shrink-0" />
            
            <div className="p-4 flex flex-col flex-1 overflow-hidden">
              <div className="flex items-center justify-between mb-3 shrink-0">
                <span className="text-white text-xs font-bold tracking-wide flex items-center gap-1.5">
                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500">GIPHY</span>
                  <span>Animatsiyalar</span>
                </span>
                <button 
                  onClick={() => {
                    setShowGifPicker(false);
                    setGifQuery('');
                  }} 
                  className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Autocomplete tags picker */}
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar shrink-0 pb-3">
                {QUICK_GIPHY_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setGifQuery(tag)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border ${
                      gifQuery.toLowerCase() === tag.toLowerCase()
                        ? 'bg-[#E60023] border-[#E60023] text-white'
                        : 'bg-neutral-900 border-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>

              {/* Dynamic search query input */}
              <div className="relative shrink-0 mb-3.5">
                <input 
                  type="text" 
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  placeholder="Giphy dan qidirish..."
                  className="w-full bg-neutral-900 border border-white/5 rounded-2xl px-11 py-3 text-white text-xs outline-none focus:border-[#E60023] transition-colors font-medium shadow-inner"
                />
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
                {gifQuery && (
                  <button 
                    onClick={() => setGifQuery('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              {/* Output grid view */}
              <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
                {loadingGifs ? (
                  <div className="h-40 flex items-center justify-center gap-2">
                    <Loader2 size={24} className="text-[#E60023] animate-spin" />
                    <span className="text-xs text-neutral-500">Qidirilmoqda...</span>
                  </div>
                ) : giphyGifs.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-center text-neutral-500 select-none">
                    <p className="text-xs">Animatsiyalar topilmadi</p>
                    <p className="text-[10px] opacity-70 mt-0.5">Boshqa so'z kiritib ko'ring.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {giphyGifs.map((gDef: any) => {
                      const imageCandidate = gDef.images?.fixed_height?.url || gDef.images?.original?.url;
                      if (!imageCandidate) return null;
                      return (
                        <div 
                          key={gDef.id}
                          onClick={() => handleGifSelect(imageCandidate)}
                          className="relative aspect-video sm:aspect-square bg-neutral-900 rounded-xl overflow-hidden cursor-pointer group hover:opacity-90 active:scale-97 transition-all border border-white/5 shadow-sm"
                        >
                          <img 
                            src={imageCandidate}
                            alt={gDef.title || 'Animax'} 
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input controls pad or Blocking Decision Permission Notification at the tail */}
      {isBlockedMeToThem ? (
        <div className="p-5 bg-neutral-900 border-t border-white/5 space-y-4 text-center pb-[calc(1.5rem+env(safe-area-inset-bottom))] shrink-0 z-10">
          <div className="flex flex-col items-center gap-2 select-none">
            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center text-[#E60023] animate-bounce mb-1">
              <UserCheck size={24} />
            </div>
            <h4 className="text-white text-sm font-bold tracking-tight">
              {nickname || liveOtherUser.full_name || liveOtherUser.username} sizga yozmoqchi
            </h4>
            <p className="text-neutral-400 text-xs max-w-xs mx-auto leading-relaxed">
              Ushbu foydalanuvchi bloklangan. Yozishmalarni davom ettirish va xabarni qabul qilish uchun ruxsat berasizmi?
            </p>
          </div>
          
          <div className="flex gap-2.5 justify-center">
            <button
              onClick={() => {
                unblockUserLocal(currentUserId, liveOtherUser.id);
                queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
                queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
                alert("Foydalanuvchi blokdan chiqarildi.");
              }}
              className="bg-[#E60023] hover:bg-red-700 active:scale-97 text-white text-xs font-bold px-6 py-2.5 rounded-full shadow transition-all"
            >
              Ha, ruxsat berish
            </button>
            <button
              onClick={onBack}
              className="bg-neutral-800 hover:bg-neutral-700 active:scale-97 text-neutral-300 text-xs font-medium px-5 py-2.5 rounded-full transition-all"
            >
              Yo'q, qaytish
            </button>
          </div>
        </div>
      ) : isBlockedThemToMe ? (
        <div className="p-5 bg-neutral-950/90 text-center text-xs text-neutral-500 border-t border-white/5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shrink-0 select-none">
          Xabar yuborish uchun muloqot huquqingiz cheklangan.
        </div>
      ) : (
        <div className="p-4 bg-[#0a0a0a] border-t border-white/5 pb-[calc(1.2rem+env(safe-area-inset-bottom))] shrink-0 z-10 transition-all">
          <form onSubmit={handleSend} className="flex items-center gap-3">
            {/* Circular plus button on left */}
            <button 
              type="button" 
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 bg-neutral-850 hover:bg-neutral-800 text-white flex items-center justify-center rounded-full shrink-0 active:scale-95 transition-transform"
              title="Image upload"
            >
              <Plus size={18} />
            </button>
            
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden" 
            />

            {/* Middle Capsule Pill */}
            <div className="flex-1 bg-[#1c1c1f] rounded-full px-4 py-1 flex items-center gap-2 border border-white/5 shadow-inner">
              <input 
                type="text" 
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={sendMutation.isPending || uploadingImg}
                placeholder={editingMessage ? "O'zgartirishni kiriting..." : "Xabar yozing..."} 
                className="flex-1 bg-transparent py-1.5 outline-none text-white text-[13.5px] font-normal placeholder-neutral-500" 
              />

              {/* Giphy selector tab inside middle pill */}
              <button 
                type="button" 
                onClick={() => setShowGifPicker(prev => !prev)}
                className={`p-1.5 rounded-full transition-colors shrink-0 ${showGifPicker ? 'text-[#E60023]' : 'text-neutral-400 hover:text-white'}`}
                title="GIF Animatsiyalar"
              >
                <Smile size={19} />
              </button>
            </div>

            {/* Circular red send button on far right */}
            <button 
              type="submit" 
              disabled={(!text.trim() && !editingMessage) || sendMutation.isPending || uploadingImg} 
              className="w-10 h-10 rounded-full text-white bg-[#E60023] hover:bg-rose-700 disabled:opacity-35 disabled:bg-neutral-850 disabled:text-neutral-500 flex items-center justify-center active:scale-95 transition-transform shrink-0 shadow"
            >
              <Send size={14} className="ml-0.5" />
            </button>
          </form>
        </div>
      )}

      {/* Context options backdrop popup sheet */}
      <AnimatePresence>
        {activeCtxOptionMsg && (
          <div 
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 text-left"
            onClick={() => setActiveCtxOptionMsg(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 280 }}
              className="bg-[#121214] border border-white/5 w-full max-w-sm rounded-3xl overflow-hidden p-5 shadow-2xl relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Context menu title */}
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-2.5">
                <span className="text-white text-xs font-bold uppercase tracking-wider opacity-60">Xabar sozlamalari</span>
                <button 
                  onClick={() => setActiveCtxOptionMsg(null)} 
                  className="p-1 rounded-full hover:bg-neutral-800 text-neutral-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Floating Emojis instant reaction line */}
              <div className="bg-neutral-900 border border-white/5 p-3 rounded-2xl flex items-center justify-between gap-1 mb-5">
                {['❤️', '👍', '😂', '😮', '😢', '🙏'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleToggleReaction(activeCtxOptionMsg.id, emoji)}
                    className="text-2xl hover:scale-130 active:scale-90 transition-transform p-1 rounded hover:bg-white/5"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Controls directory list */}
              <div className="space-y-1.5 text-sm select-none">
                <button 
                  onClick={() => {
                    const parsed = parseMessage(activeCtxOptionMsg);
                    setReplyToDraft({
                      id: activeCtxOptionMsg.id,
                      senderName: activeCtxOptionMsg.sender_id === currentUserId 
                        ? "O'zingiz" 
                        : (liveOtherUser.full_name || liveOtherUser.username),
                      text: activeCtxOptionMsg.message_type === 'image' 
                        ? 'Rasmli xabar 🖼️' 
                        : activeCtxOptionMsg.message_type === 'gif'
                          ? 'Animatsiya 👾'
                          : parsed.textContent
                    });
                    setActiveCtxOptionMsg(null);
                  }}
                  className="w-full flex items-center gap-3.5 px-4 py-3 text-white hover:bg-neutral-900 rounded-2xl transition-colors font-semibold"
                >
                  <Reply size={18} className="text-neutral-400" />
                  <span>Javob berish</span>
                </button>

                {!activeCtxOptionMsg.is_deleted && activeCtxOptionMsg.message_type === 'text' && (
                  <button 
                    onClick={async () => {
                      const parsed = parseMessage(activeCtxOptionMsg);
                      try {
                        await navigator.clipboard.writeText(parsed.textContent);
                        alert("Xabar matni nusxalandi!");
                      } catch {
                        alert("Matn nusxalashda xatolik");
                      }
                      setActiveCtxOptionMsg(null);
                    }}
                    className="w-full flex items-center gap-3.5 px-4 py-3 text-white hover:bg-neutral-900 rounded-2xl transition-colors font-semibold"
                  >
                    <User size={18} className="text-neutral-400" />
                    <span>Nusxa olish</span>
                  </button>
                )}

                {activeCtxOptionMsg.sender_id === currentUserId && !activeCtxOptionMsg.is_deleted && activeCtxOptionMsg.message_type === 'text' && (
                  <button 
                    onClick={() => {
                      const parsed = parseMessage(activeCtxOptionMsg);
                      setEditingMessage({
                        id: activeCtxOptionMsg.id,
                        text: parsed.textContent
                      });
                      setText(parsed.textContent);
                      setActiveCtxOptionMsg(null);
                    }}
                    className="w-full flex items-center gap-3.5 px-4 py-3 text-white hover:bg-neutral-900 rounded-2xl transition-colors font-semibold"
                  >
                    <Edit2 size={18} className="text-neutral-400" />
                    <span>Tahrirlash</span>
                  </button>
                )}

                {activeCtxOptionMsg.sender_id === currentUserId && !activeCtxOptionMsg.is_deleted && (
                  <button 
                    onClick={() => {
                      if (window.confirm("Bu xabarni butunlay o'chirmoqchimisiz?")) {
                        handleDeleteMessage(activeCtxOptionMsg.id);
                      }
                    }}
                    className="w-full flex items-center gap-3.5 px-4 py-3 text-red-500 hover:bg-red-500/10 rounded-2xl transition-all font-semibold"
                  >
                    <Trash2 size={18} />
                    <span>O'chirish</span>
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Options Dialog/Drawer list */}
      <AnimatePresence>
        {showOptions && (
          <div 
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center sm:items-center p-4 text-left"
            onClick={() => setShowOptions(false)}
          >
            <motion.div 
              initial={{ y: 100, opacity: 0 }} 
              animate={{ y: 0, opacity: 1 }} 
              exit={{ y: 100, opacity: 0 }} 
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="bg-neutral-900 border sm:border border-neutral-850 w-full max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden self-end sm:self-center p-4 pb-8 sm:pb-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="h-1.5 w-12 bg-neutral-800 rounded-full mx-auto mb-5 sm:hidden" />
              <h3 className="text-white/60 text-xs font-semibold px-4 mb-3 uppercase tracking-wider">Chat sozlamalari</h3>
              
              <div className="space-y-1">
                <button 
                  onClick={() => {
                    setShowOptions(false);
                    onUserPress(liveOtherUser.id);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-white hover:bg-neutral-800 rounded-2xl active:scale-99 transition-all text-sm font-medium"
                >
                  <User size={18} className="text-neutral-400" />
                  <span>Profilni ko'rish</span>
                </button>
                
                <button 
                  onClick={() => {
                    setShowOptions(false);
                    setNicknameInput(nickname || liveOtherUser.full_name || liveOtherUser.username);
                    setShowNicknameModal(true);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-white hover:bg-neutral-800 rounded-2xl active:scale-99 transition-all text-sm font-medium"
                >
                  <Edit2 size={18} className="text-neutral-400" />
                  <span>Taxallusni o'zgartirish</span>
                </button>

                {/* Move to another tab category option if not blocked */}
                {!isBlockedEither && (
                  <button
                    onClick={() => {
                      const currentCat = localStorage.getItem(`category:${conversation.id}`) || 'primary';
                      const targetCat = currentCat === 'primary' ? 'general' : 'primary';
                      localStorage.setItem(`category:${conversation.id}`, targetCat);
                      queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
                      setShowOptions(false);
                      alert(targetCat === 'general' ? "Suhbat 'Umumiy' bo'limga muvaffaqiyatli ko'chirildi!" : "Suhbat 'Asosiy' bo'limga muvaffaqiyatli ko'chirildi!");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-white hover:bg-neutral-800 rounded-2xl active:scale-99 transition-all text-sm font-medium"
                  >
                    <FolderSync size={18} className="text-neutral-400" />
                    <span>
                      {(localStorage.getItem(`category:${conversation.id}`) || 'primary') === 'primary' 
                        ? "Umumiyga ko'chirish" 
                        : "Asosiyga ko'chirish"}
                    </span>
                  </button>
                )}

                {isUserBlockedByMe(currentUserId, liveOtherUser.id) ? (
                  <button 
                    onClick={() => {
                      unblockUserLocal(currentUserId, liveOtherUser.id);
                      queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
                      queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
                      setShowOptions(false);
                      alert("Foydalanuvchi blokdan chiqarildi.");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-green-500 hover:bg-green-500/10 rounded-2xl active:scale-99 transition-all text-sm font-medium"
                  >
                    <UserCheck size={18} />
                    <span>Foydalanuvchini blokdan ochish</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      if (window.confirm("Rostdan ham bu foydalanuvchini bloklamoqchimisiz?")) {
                        blockUserLocal(currentUserId, liveOtherUser.id);
                        try {
                          blockMutation.mutate();
                        } catch (e) {
                          // ignore silent database errors if table lacks schema
                        }
                        setShowOptions(false);
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-red-500 hover:bg-red-500/10 rounded-2xl active:scale-99 transition-all text-sm font-medium"
                  >
                    <UserX size={18} />
                    <span>Foydalanuvchini bloklash</span>
                  </button>
                )}
              </div>

              <button 
                onClick={() => setShowOptions(false)}
                className="w-full mt-4 bg-neutral-850 hover:bg-neutral-800 text-white text-xs font-bold py-3.5 rounded-2xl active:scale-98 transition-all"
              >
                Yopish
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Nickname Modification Window Modal view */}
      <AnimatePresence>
        {showNicknameModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm text-left">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} 
              animate={{ scale: 1, opacity: 1 }} 
              exit={{ scale: 0.9, opacity: 0 }} 
              className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl w-full max-w-sm shadow-2xl relative"
            >
              <h3 className="text-white text-lg font-bold mb-4">Taxallusni o'zgartirish</h3>
              <p className="text-neutral-400 text-xs mb-3">Ushbu suhbat uchun foydalanuvchiga taxallus bering:</p>
              <input 
                type="text" 
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                placeholder={liveOtherUser.full_name || liveOtherUser.username}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl px-4 py-3 outline-none text-white text-sm focus:border-[#E60023] transition-colors mb-4"
              />
              <div className="flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowNicknameModal(false)}
                  className="px-4 py-2 rounded-xl text-neutral-400 hover:bg-neutral-850 font-semibold text-xs active:scale-95 transition-all"
                >
                  Bekor qilish
                </button>
                <button 
                  type="button" 
                  onClick={() => {
                    localStorage.setItem(`nickname:${conversation.id}`, nicknameInput.trim());
                    setNickname(nicknameInput.trim());
                    setShowNicknameModal(false);
                    queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
                  }}
                  className="px-5 py-2 rounded-xl bg-[#E60023] hover:bg-red-700 text-white font-semibold text-xs active:scale-95 transition-all shadow-lg"
                >
                  Saqlash
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Full screened image zoom modal popup frame */}
      <AnimatePresence>
        {showFullImage && (
          <div 
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setShowFullImage(null)}
          >
            <button 
              onClick={() => setShowFullImage(null)} 
              className="absolute top-6 right-6 p-2 rounded-full bg-neutral-900/60 text-white hover:bg-neutral-800 transition-colors z-10"
            >
              <X size={24} />
            </button>
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 25 }}
              className="max-w-full max-h-full"
            >
              <img 
                src={showFullImage} 
                alt="Zoomed representation" 
                className="max-w-[100vw] max-h-[85vh] object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
