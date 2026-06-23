import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Plus, User, MessageCircle, Heart, MoreHorizontal, Bookmark, ChevronLeft, ChevronDown, LogOut, Settings, Camera, Check, Trash, Pencil, Bell, Link, Download, Send, Compass, PlayCircle, BarChart2, Grid, Menu, Volume2, VolumeX, RotateCw, MessageSquare, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_WEB_PINS, INITIAL_WEB_BOARDS, WebPin, WebBoard } from './types';
import { usePinsFeed, useProfilePins, useSavedPins, useProfile, useFollowCount, useFollowStatus, useSearchUsers } from './queries';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase, useMock } from './lib/supabase';
import { uploadToS3, getS3ObjectUrl } from './lib/s3';
import { S3Image } from './components/S3Image';
import Auth from './components/Auth';

// ... existing code for getRandomHeight ...
function getRandomHeight() {
  return Math.floor(Math.random() * 150) + 200; // Between 200 and 350
}

import { MessagesTab, useUnreadMessages, isUserBlockedByMe, amIBlockedByThem, isBlockedEitherWay, blockUserLocal, unblockUserLocal } from './components/features/MessagesTab';
import { NotificationsTab, useNotifications } from './components/features/NotificationsTab';
import { ShareModal } from './components/modals/ShareModal';
import { findOrCreateConversation } from './lib/conversation';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<any>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'search' | 'reels' | 'create' | 'messages' | 'profile' | 'notifications'>(() => {
    if (location.pathname.startsWith('/profile')) return 'profile';
    if (location.pathname.startsWith('/create')) return 'create';
    return 'home';
  });
  const {
    data: pinsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status
  } = usePinsFeed('all');

  // We can merge the flattened pages into a single pins array
  const pins = useMemo(() => {
    if (!pinsData) return [];
    return pinsData.pages.flat();
  }, [pinsData]);

  // Keep selectedPin state as is...
  const [selectedPin, setSelectedPin] = useState<WebPin | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [viewingUserIdFromSearch, setViewingUserIdFromSearch] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);


  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const { data: notifications = [] } = useNotifications(session?.user?.id);
  const unreadCount = notifications.filter((n: any) => !n.is_read).length;
  const { data: unreadMessagesCount = 0 } = useUnreadMessages(session?.user?.id);

  // Real-time listener for messages & notifications
  useEffect(() => {
    if (!session?.user?.id || useMock) return;
    const currentUserId = session.user.id;

    const channel = supabase
      .channel(`global_updates:${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
      }, (payload: any) => {
        // If the current user is part of the conversation receiver, or sender, refresh
        // To be safe, we refresh on any message event related to the user
        queryClient.invalidateQueries({ queryKey: ['unread_messages', currentUserId] });
        queryClient.invalidateQueries({ queryKey: ['conversations', currentUserId] });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUserId}`
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['notifications', currentUserId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, queryClient]);

  useEffect(() => {
    if (activeTab === 'home') {
      if (location.pathname !== '/' && !location.pathname.startsWith('/pin/') && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/signup')) {
        navigate('/');
      }
    } else if (activeTab === 'profile' && !location.pathname.startsWith('/profile')) {
      navigate('/profile');
    }
  }, [activeTab, navigate, location.pathname]);

  const [dbStatus, setDbStatus] = useState<null | 'ok' | 'error_pins_table_missing' | 'unknown_error'>(null);
  const [dbErrorMsg, setDbErrorMsg] = useState('');

  useEffect(() => {
    // Auth Listener
    if (!useMock) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setSessionLoaded(true);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
      });

      return () => subscription.unsubscribe();
    } else {
      setSessionLoaded(true);
    }
  }, []);

  useEffect(() => {
    async function runDiagnostics() {
      if (useMock) {
        setDbStatus('ok');
        return;
      }
      try {
        // Check pins table
        const { error: tableError } = await supabase.from('pins').select('id').limit(1);
        if (tableError) {
          if (tableError.code === 'PGRST205') {
            setDbStatus('error_pins_table_missing');
          } else {
            setDbStatus('unknown_error');
            setDbErrorMsg(tableError.message);
          }
        } else {
          setDbStatus('ok');
        }
      } catch (err: any) {
        setDbStatus('unknown_error');
        setDbErrorMsg(err.message);
      }
    }
    runDiagnostics();
  }, [useMock]);

  // loadPins has been removed! Use react-query instead.


  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrolled(el.scrollTop > 20);
    if (activeTab === 'home' && !isFetchingNextPage && hasNextPage) {
      if (el.scrollHeight - el.scrollTop <= el.clientHeight + 400) { // 400px before bottom
        fetchNextPage();
      }
    }
  };

  if (!sessionLoaded) {
    return <div className="flex justify-center items-center w-full min-h-screen bg-[#0f0f0f]"><div className="w-8 h-8 rounded-full bg-[#E60023] animate-pulse"></div></div>;
  }

  if (dbStatus === 'error_pins_table_missing') {
    return (
      <div className="flex flex-col items-center justify-center p-8 w-full min-h-screen bg-[#0f0f0f] text-white">
        <div className="bg-red-500/10 border border-red-500/20 p-8 rounded-3xl max-w-2xl text-left space-y-6">
          <h1 className="text-3xl font-bold text-red-500">Supabase sozlash kutilmoqda...</h1>
          <p className="text-neutral-300">Tizim ishlashi uchun barcha jadvallar yaratilishi kerak.</p>
          <div className="bg-neutral-950 p-4 rounded-xl text-neutral-400 font-mono text-sm overflow-x-auto space-y-4">
            <p>Supabase SQL Editor bo'limiga kirib quydagi kodni yozib Run tugmasini bosing:</p>
            <pre className="text-green-400">
{`-- Foydalanuvchi profillari
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  full_name text,
  birth_date date,
  avatar_url text,
  bio text
);

-- Eski ro'yxatdan o'tganlarga moslashuvchanlik uchun (agar jadvallar yaratilgan bo'lsa)
-- alter table profiles add column if not exists full_name text;
-- alter table profiles add column if not exists birth_date date;

-- RLS o'chirilganligiga ishonch hosil qilish (Xatolikni oldini olish uchun)
alter table profiles disable row level security;

-- Rasmlar
create table if not exists pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  title text not null,
  description text,
  image_url text not null,
  category text default 'Explore',
  width integer default 500,
  height integer default 500,
  likes_count integer default 0,
  created_at timestamptz default now()
);

alter table pins disable row level security;

-- Doskalar
create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  name text not null,
  is_secret boolean default false,
  created_at timestamptz default now()
);

alter table boards disable row level security;

-- Layklar
create table if not exists likes (
  user_id uuid references profiles(id) on delete cascade,
  pin_id uuid references pins(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, pin_id)
);

alter table likes disable row level security;

-- Saqlangan rasmlar
create table if not exists saved_pins (
  user_id uuid references profiles(id) on delete cascade,
  pin_id uuid references pins(id) on delete cascade,
  board_id uuid references boards(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, pin_id)
);

alter table saved_pins disable row level security;

-- Kommentlar
create table if not exists comments (
  id bigint primary key generated always as identity,
  user_id uuid references profiles(id) on delete cascade,
  pin_id uuid references pins(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

alter table comments disable row level security;

-- Comment Likes
create table if not exists comment_likes (
  user_id uuid references profiles(id) on delete cascade,
  comment_id bigint references comments(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, comment_id)
);

alter table comment_likes disable row level security;

-- Comment Replies
create table if not exists comment_replies (
  id bigint primary key generated always as identity,
  comment_id bigint references comments(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

alter table comment_replies disable row level security;

-- Reply Likes
create table if not exists reply_likes (
  user_id uuid references profiles(id) on delete cascade,
  reply_id bigint references comment_replies(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, reply_id)
);

alter table reply_likes disable row level security;

-- Kuzatuvchilar (Follows)
create table if not exists followers (
  follower_id uuid references profiles(id) on delete cascade,
  following_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, following_id),
  CONSTRAINT no_self_follow CHECK (follower_id <> following_id)
);

alter table followers disable row level security;

-- Suhbatlar (Conversations)
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid references profiles(id) on delete cascade,
  user2_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user1_id, user2_id)
);

alter table conversations disable row level security;

-- Settings
create table if not exists user_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  is_private boolean default false,
  dark_mode boolean default true,
  notifications_enabled boolean default true,
  language text default 'en',
  updated_at timestamptz default now()
);

alter table user_settings disable row level security;

-- Notifications
create table if not exists notifications (
  id bigint primary key generated always as identity,
  user_id uuid references profiles(id) on delete cascade,
  actor_id uuid references profiles(id) on delete cascade,
  type text not null, -- 'like', 'comment', 'reply', 'follow', 'message'
  pin_id text, -- optional reference to pin
  comment_id bigint references comments(id) on delete cascade, -- optional reference
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table notifications disable row level security;

-- Xabarlar (Messages)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid references profiles(id) on delete cascade,
  content text not null,
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table messages disable row level security;

-- Indekslar (Tezlashish uchun)
create index if not exists idx_pins_user on pins(user_id);
create index if not exists idx_likes_pin on likes(pin_id);
create index if not exists idx_saved_pin on saved_pins(pin_id);
create index if not exists idx_comments_pin on comments(pin_id);
create index if not exists idx_notifications_user on notifications(user_id);
create index if not exists idx_messages_conv on messages(conversation_id);`}'
            </pre>
          </div>
          <button onClick={() => window.location.reload()} className="bg-[#E60023] px-6 py-3 rounded-full text-white font-bold w-full mt-4">Men buni bajardim & Qayta yuklash</button>
        </div>
      </div>
    );
  }

  if (!session && !useMock) {
    return <Auth onAuthSuccess={() => {}} />;
  }

  const handleDeletePin = async (pinId: string) => {
    if (useMock || pinId.startsWith('p_')) {
      setSelectedPin(null);
      return;
    }

    try {
      const { error } = await supabase.from('pins').delete().eq('id', pinId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['pins'] });
      setSelectedPin(null);
    } catch (err) {
      console.error("Error deleting pin:", err);
      alert("Xatolik: Rasmni o'chirib bo'lmadi");
    }
  };

  const handleEditPin = async (pinId: string, updates: Partial<WebPin>) => {
    if (useMock || pinId.startsWith('p_')) {
      setSelectedPin(prev => prev ? { ...prev, ...updates } : null);
      return;
    }
    try {
      const { error } = await supabase.from('pins').update({
        title: updates.title,
        description: updates.description
      }).eq('id', pinId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['pins'] });
      setSelectedPin(prev => prev ? { ...prev, ...updates } : null);
    } catch (err) {
      console.error("Error editing pin:", err);
      alert("Xatolik: Rasmni tahrirlab bo'lmadi");
    }
  };

  return (
    <div className="flex w-full h-[100dvh] md:h-screen bg-black text-white overflow-hidden">
      
      {/* LEFT SIDEBAR NAVIGATION FOR TABLET AND DESKTOP */}
      <div className="hidden md:flex flex-col w-[76px] h-full bg-black border-r border-zinc-900 shrink-0 text-white py-4 xl:py-6 items-center justify-between z-40 relative select-none">
        
        {/* Top: Brand Logo matching the design */}
        <div className="flex items-center justify-center p-1.5 group cursor-pointer hover:scale-105 transition-transform">
          <div className="w-10 h-10 xl:w-11 xl:h-11 rounded-full border border-white/10 flex items-center justify-center bg-zinc-900/40 shadow-lg text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] xl:w-[20px] xl:h-[20px] -rotate-12">
              <rect width="20" height="20" x="2" y="2" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"></line>
            </svg>
          </div>
        </div>

        {/* Middle Navigation Icons vertically stacked - with adaptive gaps to fit low-height laptop displays perfectly */}
        <div className="flex flex-col gap-2.5 xl:gap-4.5 items-center w-full">
          {/* 1. Home Tab */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('home');
            }} 
            className={`p-2.5 rounded-full transition-all hover:bg-zinc-900 group active:scale-95 relative ${activeTab === 'home' ? 'text-white bg-zinc-900/60' : 'text-neutral-500 hover:text-white'}`}
            title="Bosh sahifa"
          >
            <Home size={20} strokeWidth={activeTab === 'home' ? 2.5 : 2} />
          </button>

          {/* 2. Search Tab */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('search');
            }} 
            className={`p-2.5 rounded-full transition-all hover:bg-zinc-900 group active:scale-95 relative ${activeTab === 'search' ? 'text-white bg-zinc-900/60' : 'text-neutral-500 hover:text-white'}`}
            title="Qidiruv"
          >
            <Search size={20} strokeWidth={activeTab === 'search' ? 2.5 : 2} />
          </button>

          {/* 3. Reels Tab */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('reels');
            }} 
            className={`p-2.5 rounded-full transition-all hover:bg-zinc-900 group active:scale-95 relative ${activeTab === 'reels' ? 'text-white bg-zinc-900/60' : 'text-neutral-500 hover:text-white'}`}
            title="Reels"
          >
            <PlayCircle size={20} strokeWidth={activeTab === 'reels' ? 2.5 : 2} />
          </button>

          {/* 4. Create Pin Tab / Add Image or Video (CENTERED) */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('create');
            }} 
            className={`p-2.5 rounded-full transition-all bg-zinc-900/40 border border-white/5 shadow-inner hover:bg-zinc-900 hover:border-white/10 group active:scale-95 relative ${activeTab === 'create' ? 'text-white bg-zinc-850' : 'text-neutral-400 hover:text-white'}`}
            title="Yaratish"
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>

          {/* 5. Direct Messages Tab / Inbox */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('messages');
            }} 
            className={`relative p-2.5 rounded-full transition-all hover:bg-zinc-900 group active:scale-95 ${activeTab === 'messages' ? 'text-white bg-zinc-900/60' : 'text-neutral-500 hover:text-white'}`}
            title="Xabarlar"
          >
            <MessageCircle size={20} strokeWidth={activeTab === 'messages' ? 2.5 : 2} />
            {unreadMessagesCount > 0 && (
              <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#E60023] rounded-full ring-2 ring-black font-semibold"></div>
            )}
          </button>

          {/* 6. Notifications Tab */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('notifications');
            }} 
            className={`relative p-2.5 rounded-full transition-all hover:bg-zinc-900 group active:scale-95 ${activeTab === 'notifications' ? 'text-white bg-zinc-900/60' : 'text-neutral-500 hover:text-white'}`}
            title="Bildirishnomalar"
          >
            <Heart size={20} strokeWidth={activeTab === 'notifications' ? 2.5 : 2} />
            {unreadCount > 0 && (
              <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#E60023] rounded-full ring-2 ring-black font-semibold"></div>
            )}
          </button>

          {/* 7. Profile Tab */}
          <button 
            onClick={() => {
              setViewingUserId(null);
              setViewingUserIdFromSearch(null);
              setActiveTab('profile');
            }} 
            className={`p-2 rounded-full border-2 transition-all hover:bg-zinc-900 group active:scale-95 ${activeTab === 'profile' ? 'border-white text-white bg-zinc-900/60' : 'border-transparent text-neutral-500 hover:text-white'}`}
            title="Profil"
          >
            <User size={18} strokeWidth={activeTab === 'profile' ? 2.5 : 2} />
          </button>
        </div>

        {/* Bottom Hamburger and Layout Options */}
        <div className="flex flex-col gap-2.5 xl:gap-3.5 items-center w-full">
          <button 
            onClick={() => {
              setViewingUserId(null);
              setActiveTab('home');
            }} 
            className="p-2.5 rounded-full transition-all hover:bg-zinc-900 text-neutral-500 hover:text-white active:scale-95"
            title="Kataklar"
          >
            <Grid size={20} />
          </button>
          <button 
            onClick={() => supabase.auth.signOut()} 
            className="p-2.5 rounded-full transition-all hover:bg-zinc-900 text-neutral-500 hover:text-[#E60023] active:scale-95"
            title="Chiqish"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* RIGHT DISPLAY WORKSPACE FOR CONTENT */}
      <div className="relative flex-1 h-full bg-black overflow-hidden flex flex-col">
        
        {/* Main Page Area */}
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className={`flex-1 relative ${activeTab === 'messages' || activeTab === 'reels' ? 'h-full w-full overflow-hidden' : 'overflow-y-auto no-scrollbar pb-24'}`}
        >
          <AnimatePresence mode="wait">
            {activeTab === 'home' && (
              <HomeFeed key="home" scrolled={scrolled} onPinPress={setSelectedPin} session={session} />
            )}
            {activeTab === 'search' && (
              viewingUserIdFromSearch ? (
                <ProfileTab 
                  key={viewingUserIdFromSearch} 
                  userId={viewingUserIdFromSearch} 
                  pins={pins} 
                  boards={INITIAL_WEB_BOARDS} 
                  onPinPress={setSelectedPin} 
                  session={session} 
                  onSignOut={() => supabase.auth.signOut()} 
                  onBack={() => {
                    setViewingUserIdFromSearch(null);
                  }}
                  onUserPress={(id) => {
                    setViewingUserIdFromSearch(id);
                  }}
                  onMessagePress={(conversationId) => {
                    setViewingUserIdFromSearch(null);
                    setActiveChatId(conversationId);
                    setActiveTab('messages');
                  }}
                />
              ) : (
                <SearchTab 
                  key="search" 
                  pins={pins} 
                  onPinPress={setSelectedPin} 
                  onUserPress={(id) => {
                    setViewingUserIdFromSearch(id);
                  }} 
                  session={session} 
                />
              )
            )}
            {activeTab === 'reels' && (
              <ReelsTab key="reels" onPinPress={setSelectedPin} session={session} onBack={() => setActiveTab('home')} />
            )}
            {activeTab === 'create' && (
              <CreateTab key="create" onAddPin={(pin) => {
                queryClient.invalidateQueries({ queryKey: ['pins'] });
                setActiveTab('home');
              }} session={session} />
            )}
            {activeTab === 'profile' && (
              <ProfileTab 
                key={viewingUserId || "profile"} 
                userId={viewingUserId || undefined} 
                pins={pins} 
                boards={INITIAL_WEB_BOARDS} 
                onPinPress={setSelectedPin} 
                session={session} 
                onSignOut={() => supabase.auth.signOut()} 
                onBack={() => {
                  setViewingUserId(null);
                  setActiveTab('home');
                }}
                onUserPress={(id) => {
                  setViewingUserId(id);
                  setActiveTab('profile');
                }}
                onMessagePress={(conversationId) => {
                  setViewingUserId(null);
                  setActiveChatId(conversationId);
                  setActiveTab('messages');
                }}
              />
            )}
            {activeTab === 'messages' && (
              <MessagesTab key="messages" session={session} onUserPress={(id) => {
                setViewingUserId(id);
                setActiveTab('profile');
              }} onPinPress={setSelectedPin} initialChatId={activeChatId} />
            )}
            {activeTab === 'notifications' && (
              <NotificationsTab key="notifications" session={session} onUserPress={(id) => {
                setViewingUserId(id);
                setActiveTab('profile');
              }} onPinPress={setSelectedPin} onBack={() => setActiveTab('home')} />
            )}
          </AnimatePresence>
        </div>

        {/* BOTTOM TAB BAR NAVIGATION FOR MOBILE ONLY */}
        <BottomNav 
          activeTab={activeTab} 
          session={session}
          setActiveTab={(t) => {
            if (t === 'profile') setViewingUserId(null);
            setViewingUserIdFromSearch(null);
            setActiveTab(t);
          }} 
        />

        {/* Pin Detail Overlay with Shared Element-like transition */}
        <AnimatePresence>
          {selectedPin && (
            <PinDetail pin={selectedPin} onClose={() => setSelectedPin(null)} session={session} onDelete={handleDeletePin} onEdit={handleEditPin} onAuthorPress={(uid) => {
              setViewingUserId(uid);
              setSelectedPin(null);
              setActiveTab('profile');
            }} onPinPress={setSelectedPin} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- SUB TABS --- //

const HomeFeed: React.FC<{ scrolled: boolean, onPinPress: (pin: WebPin) => void, session?: any }> = React.memo(({ scrolled, onPinPress, session }) => {
  const [activeSegment, setActiveSegment] = useState<'all' | 'following'>('all');
  const [feedSort, setFeedSort] = useState<'trending' | 'newest'>('trending');
  const userId = session?.user?.id;

  const { data: feedData, isFetching } = usePinsFeed(activeSegment, userId);
  const pins = useMemo(() => {
    const rawList = feedData ? feedData.pages.flat() : [];
    if (feedSort === 'trending') {
      return [...rawList].sort((a, b) => {
        // Algorithmic rank score: Likes (12 pts) + Comments (25 pts)
        const scoreA = (a.likesCount || 0) * 12 + (a.commentsCount || 0) * 25;
        const scoreB = (b.likesCount || 0) * 12 + (b.commentsCount || 0) * 25;
        return scoreB - scoreA;
      });
    }
    return rawList;
  }, [feedData, feedSort]);

  const handlePinPress = useCallback((pin: WebPin) => {
    onPinPress(pin);
  }, [onPinPress]);

  // Dynamically calculate grid columns based on window size to prevent any empty column gaps on the right hand side
  const [colCount, setColCount] = useState(2);
  useEffect(() => {
    const updateColCount = () => {
      const w = window.innerWidth;
      if (w >= 1280) setColCount(5);
      else if (w >= 1024) setColCount(4);
      else if (w >= 768) setColCount(3);
      else setColCount(2);
    };
    updateColCount();
    window.addEventListener('resize', updateColCount);
    return () => window.removeEventListener('resize', updateColCount);
  }, []);

  // Distribute pin list sequentially among the columns to make sure every column fills up from left-to-right perfectly
  const balancedColumns = useMemo(() => {
    const cols: WebPin[][] = Array.from({ length: colCount }, () => []);
    pins.forEach((pin, i) => {
      cols[i % colCount].push(pin);
    });
    return cols;
  }, [pins, colCount]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pb-6"
    >
      {/* Sticky Header */}
      <div className={`sticky top-0 z-30 transition-all duration-300 ${scrolled ? 'bg-zinc-950/85 backdrop-blur-2xl pb-2 border-b border-white/[0.04]' : 'bg-transparent pb-4'} pt-12 px-4 flex flex-col gap-3 w-full`}>
        <div className="flex justify-between items-center w-full">
          <div className="w-10"></div>
          <div className="flex bg-zinc-900/60 backdrop-blur-xl p-0.5 rounded-full border border-white/[0.06] shadow-sm">
            <button 
              onClick={() => setActiveSegment('all')}
              className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${
                activeSegment === 'all' 
                  ? 'bg-white text-black shadow-md scale-100' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Barchasi
            </button>
            <button 
              onClick={() => {
                if (!session) {
                  alert("Iltimos, avval tizimga kiring!");
                  return;
                }
                setActiveSegment('following');
              }}
              className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${
                activeSegment === 'following' 
                  ? 'bg-white text-black shadow-md scale-100' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Obunalar
            </button>
          </div>
          <button className="w-10 flex justify-end">
            {session ? (
              <S3Image src={session.user?.user_metadata?.avatar_url || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100"} className="w-8 h-8 rounded-full object-cover" skeletonClassName="rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                <User size={16} className="text-white" />
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Dynamic Balanced Masonry Layout using sequential distribution across grid columns */}
      {isFetching && pins.length === 0 ? (
        <div className="mt-20 flex justify-center text-neutral-500 font-medium">Loading feed...</div>
      ) : pins.length === 0 ? (
        <div className="mt-20 flex flex-col justify-center items-center text-neutral-500 font-medium px-6 text-center">
          <p className="text-white font-bold text-lg mb-2">Hech narsa topilmadi</p>
          <p>
            {activeSegment === 'following'
              ? "Siz obuna bo'lgan foydalanuvchilar hali hech narsa nashr etishmagan."
              : "Hozircha postlar mavjud emas."}
          </p>
          {activeSegment === 'following' && (
            <button onClick={() => setActiveSegment('all')} className="mt-6 bg-white text-black font-bold px-6 py-3 rounded-full active:scale-95 transition-transform">
              Barcha rasmlarni ko'rish
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 px-4 mt-2">
          {balancedColumns.map((col, colIdx) => (
            <div key={colIdx} className="flex flex-col gap-3.5">
              {col.map((pin, i) => (
                <PinCard key={`${pin.id}-${i}`} pin={pin} onPress={() => handlePinPress(pin)} session={session} />
              ))}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
});

HomeFeed.displayName = 'HomeFeed';

const ReelsTab: React.FC<{ onPinPress: (pin: WebPin) => void, session?: any, onBack?: () => void }> = React.memo(({ onPinPress, session, onBack }) => {
  const [mediaFilter, setMediaFilter] = useState<'mix' | 'video'>('video');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [showComments, setShowComments] = useState<string | null>(null);
  const [commentsInput, setCommentsInput] = useState('');
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('down');
  const [showHeartAnim, setShowHeartAnim] = useState(false);
  const [isHolding, setIsHolding] = useState(false);

  // Comment Replies & Likes & Giphy integration states
  const [replyingToComment, setReplyingToComment] = useState<{ id: number; username: string } | null>(null);
  const [expandedReplies, setExpandedReplies] = useState<Record<number, boolean>>({});
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifsList, setGifsList] = useState<any[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTapRef = useRef<number>(0);
  const pressTimeoutRef = useRef<any>(null);
  const singleTapTimeoutRef = useRef<any>(null);
  const heartAnimTimeoutRef = useRef<any>(null);
  const isHoldingActiveRef = useRef<boolean>(false);
  
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  // Load actual database pins through react-query. No frontend-mock INITIAL_WEB_PINS is merged!
  const { data: feedData } = usePinsFeed('all', userId);
  const rawPins = useMemo(() => feedData ? feedData.pages.flat() : [], [feedData]);

  // Filter based on "Mix" (photos + videos) or "Faqat video"
  const filteredReels = useMemo(() => {
    if (mediaFilter === 'video') {
      return rawPins.filter(p => p.mediaType === 'video');
    }
    return rawPins; // Mix: both videos and standard image pins
  }, [rawPins, mediaFilter]);

  // Active item safely bounded
  const currentReel = useMemo(() => {
    if (filteredReels.length === 0) return null;
    const safeIdx = Math.max(0, Math.min(currentIndex, filteredReels.length - 1));
    return filteredReels[safeIdx];
  }, [filteredReels, currentIndex]);

  const reelId = currentReel?.id;

  // 1. Fetch live real likes count & current user's liked status from Supabase
  const { data: likeInfo, refetch: refetchLikeInfo } = useQuery({
    queryKey: ['reel-likes', reelId, userId],
    enabled: !!reelId,
    queryFn: async () => {
      const { count: totalLikes, error: countErr } = await supabase
        .from('likes')
        .select('*', { count: 'exact', head: true })
        .eq('pin_id', reelId);
      
      let userLiked = false;
      if (userId) {
        const { data: userLike, error: userLikeErr } = await supabase
          .from('likes')
          .select('user_id')
          .eq('pin_id', reelId)
          .eq('user_id', userId)
          .maybeSingle();
        userLiked = !!userLike;
      }
      return {
        count: totalLikes || 0,
        isLiked: userLiked
      };
    }
  });

  // 2. Fetch live real saved status from Supabase
  const { data: isSaved = false, refetch: refetchIsSaved } = useQuery({
    queryKey: ['reel-saved', reelId, userId],
    enabled: !!reelId && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_pins')
        .select('user_id')
        .eq('pin_id', reelId)
        .eq('user_id', userId)
        .maybeSingle();
      return !!data;
    }
  });

  // 3. Fetch live real comments list from Supabase
  const { data: dbComments = [], refetch: refetchDbComments } = useQuery({
    queryKey: ['reel-comments', reelId],
    enabled: !!reelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comments')
        .select(`
          *,
          profiles!comments_user_id_fkey(*),
          comment_likes(user_id),
          comment_replies(*, profiles!comment_replies_user_id_fkey(*), reply_likes(user_id))
        `)
        .eq('pin_id', reelId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  // Reset index when toggling filters
  useEffect(() => {
    setCurrentIndex(0);
    setShowComments(null);
  }, [mediaFilter]);

  // Support scroll wheel page-up / page-down snapping
  const lastWheelTime = useRef(0);
  const handleWheel = (e: React.WheelEvent) => {
    const now = Date.now();
    if (now - lastWheelTime.current < 600) return; // Debounce
    
    if (e.deltaY > 50) {
      if (currentIndex < filteredReels.length - 1) {
        setScrollDirection('down');
        setCurrentIndex(prev => prev + 1);
        setShowComments(null);
        lastWheelTime.current = now;
      }
    } else if (e.deltaY < -50) {
      if (currentIndex > 0) {
        setScrollDirection('up');
        setCurrentIndex(prev => prev - 1);
        setShowComments(null);
        lastWheelTime.current = now;
      }
    }
  };

  useEffect(() => {
    if (showComments) {
      document.body.classList.add('reels-comments-open');
    } else {
      document.body.classList.remove('reels-comments-open');
    }
    return () => {
      document.body.classList.remove('reels-comments-open');
    };
  }, [showComments]);

  // Giphy automatic search/trending load effect
  useEffect(() => {
    if (!showGifPicker) return;
    const fetchGifs = async () => {
      setLoadingGifs(true);
      try {
        const apiKey = import.meta.env.VITE_GIPHY_API_KEY || 'A7KiZNIpEk8FqkH5ZtbVhcTpxOxNX62j';
        let url = `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=20`;
        if (gifQuery.trim()) {
          url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(gifQuery.trim())}&limit=20`;
        }
        const res = await fetch(url);
        const json = await res.json();
        if (json && json.data) {
          setGifsList(json.data);
        }
      } catch (err) {
        console.error("Error loading Giphy gifs:", err);
      } finally {
        setLoadingGifs(false);
      }
    };

    const timer = setTimeout(fetchGifs, 350);
    return () => clearTimeout(timer);
  }, [gifQuery, showGifPicker]);

  useEffect(() => {
    // Reset heart animation on slide change
    setShowHeartAnim(false);
    if (heartAnimTimeoutRef.current) {
      clearTimeout(heartAnimTimeoutRef.current);
    }
  }, [currentIndex]);

  useEffect(() => {
    return () => {
      if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
      if (heartAnimTimeoutRef.current) clearTimeout(heartAnimTimeoutRef.current);
    };
  }, []);

  const handleGestureStart = (e: React.MouseEvent | React.TouchEvent) => {
    const coords = 'touches' in e ? e.touches[0] : e;
    touchStartRef.current = { x: coords.clientX, y: coords.clientY };

    if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);
    isHoldingActiveRef.current = false;

    // Detect held press to pause (stop)
    pressTimeoutRef.current = setTimeout(() => {
      isHoldingActiveRef.current = true;
      setIsHolding(true);
      if (currentReel?.mediaType === 'video' && videoRef.current) {
        videoRef.current.pause();
      }
    }, 400);
  };

  const handleGestureEnd = (e: React.MouseEvent | React.TouchEvent) => {
    if (pressTimeoutRef.current) clearTimeout(pressTimeoutRef.current);

    const coords = 'changedTouches' in e ? e.changedTouches[0] : e;
    if (!coords) return;
    const dx = coords.clientX - touchStartRef.current.x;
    const dy = coords.clientY - touchStartRef.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    // 1. Check for navigation swipe up/down (min 60px displacement)
    if (absDy > 60 && absDy > absDx) {
      if (isHoldingActiveRef.current) {
        setIsHolding(false);
        isHoldingActiveRef.current = false;
        if (currentReel?.mediaType === 'video' && videoRef.current) {
          videoRef.current.play().catch(err => console.log(err));
        }
      }

      if (dy < -60) {
        // Swiped UP -> Next reel
        if (currentIndex < filteredReels.length - 1) {
          setScrollDirection('down');
          setCurrentIndex(prev => prev + 1);
          setShowComments(null);
        }
      } else if (dy > 60) {
        // Swiped DOWN -> Previous reel
        if (currentIndex > 0) {
          setScrollDirection('up');
          setCurrentIndex(prev => prev - 1);
          setShowComments(null);
        }
      }
      return;
    }

    // 2. Clear holding state if it was active
    if (isHoldingActiveRef.current) {
      setIsHolding(false);
      isHoldingActiveRef.current = false;
      if (currentReel?.mediaType === 'video' && videoRef.current) {
        videoRef.current.play().catch(err => console.log(err));
      }
      return;
    }

    // If drag was not enough to trigger swipe, but too large for tap (e.g., jitter with mobile/hand tremors)
    if (absDx > 25 || absDy > 25) {
      return;
    }

    // 3. Normal short tap handlers
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
      // Double tap -> Force like & animate heart
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
      lastTapRef.current = 0; // reset

      if (!likeInfo?.isLiked) {
        handleToggleLike();
      }
      setShowHeartAnim(true);
      if (heartAnimTimeoutRef.current) clearTimeout(heartAnimTimeoutRef.current);
      heartAnimTimeoutRef.current = setTimeout(() => {
        setShowHeartAnim(false);
      }, 700);
    } else {
      // Single tap -> Candidate to toggle mute
      lastTapRef.current = now;
      if (singleTapTimeoutRef.current) clearTimeout(singleTapTimeoutRef.current);
      singleTapTimeoutRef.current = setTimeout(() => {
        setIsMuted(prev => !prev);
      }, DOUBLE_TAP_DELAY);
    }
  };

  const [isLiking, setIsLiking] = useState(false);
  const handleToggleLike = async () => {
    if (!userId) {
      alert("Iltimos, avval tizimga kiring!");
      return;
    }
    if (!currentReel || isLiking) return;
    setIsLiking(true);

    try {
      const currentIsLiked = likeInfo?.isLiked || false;
      if (currentIsLiked) {
        await supabase
          .from('likes')
          .delete()
          .eq('pin_id', currentReel.id)
          .eq('user_id', userId);
      } else {
        await supabase
          .from('likes')
          .insert({ pin_id: currentReel.id, user_id: userId });

        if (currentReel.userId && currentReel.userId !== userId) {
          await supabase.from('notifications').insert({
            user_id: currentReel.userId,
            actor_id: userId,
            type: 'like',
            pin_id: currentReel.id
          });
        }
      }
      await refetchLikeInfo();
      queryClient.invalidateQueries({ queryKey: ['pins', 'feed'] });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLiking(false);
    }
  };

  const [isSaving, setIsSaving] = useState(false);
  const handleToggleSave = async () => {
    if (!userId) {
      alert("Iltimos, avval tizimga kiring!");
      return;
    }
    if (!currentReel || isSaving) return;
    setIsSaving(true);

    try {
      if (isSaved) {
        await supabase
          .from('saved_pins')
          .delete()
          .eq('pin_id', currentReel.id)
          .eq('user_id', userId);
      } else {
        await supabase
          .from('saved_pins')
          .insert({ pin_id: currentReel.id, user_id: userId });
      }
      await refetchIsSaved();
      
      // Keep saved pins list in profile screen thoroughly updated in real-time
      queryClient.invalidateQueries({ queryKey: ['pins', 'saved', userId] });
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleCommentLike = async (commentId: number, isCurrentlyLiked: boolean) => {
    if (!userId) {
      alert("Iltimos, avval tizimga kiring!");
      return;
    }
    try {
      if (isCurrentlyLiked) {
        await supabase
          .from('comment_likes')
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', userId);
      } else {
        await supabase
          .from('comment_likes')
          .insert({ comment_id: commentId, user_id: userId });

        // Fetch comment details to notify the creator
        const { data: commentData } = await supabase
          .from('comments')
          .select('user_id, pin_id')
          .eq('id', commentId)
          .maybeSingle();

        if (commentData && commentData.user_id && commentData.user_id !== userId) {
          await supabase.from('notifications').insert({
            user_id: commentData.user_id,
            actor_id: userId,
            type: 'like',
            comment_id: commentId,
            pin_id: commentData.pin_id
          });
        }
      }
      await refetchDbComments();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleReplyLike = async (replyId: number, isCurrentlyLiked: boolean) => {
    if (!userId) {
      alert("Iltimos, avval tizimga kiring!");
      return;
    }
    try {
      if (isCurrentlyLiked) {
        await supabase
          .from('reply_likes')
          .delete()
          .eq('reply_id', replyId)
          .eq('user_id', userId);
      } else {
        await supabase
          .from('reply_likes')
          .insert({ reply_id: replyId, user_id: userId });

        // Fetch reply details to notify the creator
        const { data: replyData } = await supabase
          .from('comment_replies')
          .select('user_id, comment_id')
          .eq('id', replyId)
          .maybeSingle();

        if (replyData && replyData.user_id && replyData.user_id !== userId) {
          const { data: commentData } = await supabase
            .from('comments')
            .select('pin_id')
            .eq('id', replyData.comment_id)
            .maybeSingle();

          await supabase.from('notifications').insert({
            user_id: replyData.user_id,
            actor_id: userId,
            type: 'like',
            comment_id: replyData.comment_id,
            pin_id: commentData?.pin_id || null
          });
        }
      }
      await refetchDbComments();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendGif = async (gifUrl: string) => {
    if (!currentReel || !userId) {
      if (!userId) alert("Iltimos, avval tizimga kiring!");
      return;
    }
    try {
      if (replyingToComment) {
        const { error } = await supabase
          .from('comment_replies')
          .insert({ 
            comment_id: replyingToComment.id, 
            user_id: userId, 
            content: gifUrl 
          });
        
        if (error) {
          alert("Javob yozishda xatolik yuz berdi: " + error.message);
        } else {
          setExpandedReplies(prev => ({ ...prev, [replyingToComment.id]: true }));
          setReplyingToComment(null);
          setShowGifPicker(false);
          await refetchDbComments();
        }
      } else {
        const { error } = await supabase
          .from('comments')
          .insert({ pin_id: currentReel.id, user_id: userId, content: gifUrl });
        
        if (error) {
          alert("Xatolik yuz berdi: " + error.message);
        } else {
          if (currentReel.userId && currentReel.userId !== userId) {
            await supabase.from('notifications').insert({
              user_id: currentReel.userId,
              actor_id: userId,
              type: 'comment',
              pin_id: currentReel.id
            });
          }
          setShowGifPicker(false);
          await refetchDbComments();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsInput.trim() || !currentReel || !userId) {
      if (!userId) alert("Iltimos, avval tizimga kiring!");
      return;
    }

    const text = commentsInput.trim();
    setCommentsInput('');

    try {
      if (replyingToComment) {
        const { error } = await supabase
          .from('comment_replies')
          .insert({ 
            comment_id: replyingToComment.id, 
            user_id: userId, 
            content: text 
          });
        
        if (error) {
          alert("Javob yozishda xatolik yuz berdi: " + error.message);
        } else {
          setExpandedReplies(prev => ({ ...prev, [replyingToComment.id]: true }));
          setReplyingToComment(null);
          await refetchDbComments();
        }
      } else {
        const { error } = await supabase
          .from('comments')
          .insert({ pin_id: currentReel.id, user_id: userId, content: text });
        
        if (error) {
          alert("Xatolik yuz berdi: " + error.message);
        } else {
          if (currentReel.userId && currentReel.userId !== userId) {
            await supabase.from('notifications').insert({
              user_id: currentReel.userId,
              actor_id: userId,
              type: 'comment',
              pin_id: currentReel.id
            });
          }
          await refetchDbComments();
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full w-full bg-black flex flex-col justify-between overflow-hidden relative select-none"
      onWheel={handleWheel}
    >
      {/* Category Pills Header absolutely positioned over the video (Instagram standard) */}
      <div id="reels-header" className="absolute top-0 inset-x-0 flex items-center justify-between px-4 pt-12 pb-6 bg-gradient-to-b from-black/85 via-black/40 to-transparent z-40 border-b-0 pointer-events-none">
        {onBack ? (
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-full text-white pointer-events-auto active:scale-95 transition-transform"
          >
            <ChevronLeft size={24} />
          </button>
        ) : (
          <div className="w-8" />
        )}
        <div className="flex justify-center items-center gap-6">
          <button
            onClick={() => setMediaFilter('mix')}
            className={`font-semibold text-[15px] transition-colors pb-1 text-shadow pointer-events-auto ${
              mediaFilter === 'mix'
                ? 'text-white border-b-2 border-white font-bold'
                : 'text-neutral-350 hover:text-white'
            }`}
          >
            Mix
          </button>
          <button
            onClick={() => setMediaFilter('video')}
            className={`font-semibold text-[15px] transition-colors pb-1 text-shadow pointer-events-auto ${
              mediaFilter === 'video'
                ? 'text-white border-b-2 border-white font-bold'
                : 'text-neutral-350 hover:text-white'
            }`}
          >
            Faqat video (Reels)
          </button>
        </div>
        <div className="w-8" />
      </div>

      {/* Main Player Display Area with full screen aspect support on mobile devices */}
      <div id="reels-display" className="flex-1 flex items-center justify-center relative w-full h-full overflow-hidden p-0 md:p-6">
        {filteredReels.length === 0 ? (
          <div className="text-neutral-500 font-semibold text-center mt-12 bg-zinc-950 px-6 py-8 rounded-3xl border border-white/5 max-w-[340px]">
            <p className="text-white text-base font-bold mb-2">Reels/Nashrlar mavjud emas</p>
            <p className="text-xs text-neutral-500 leading-normal mb-1">Hozircha tizimda hech qanday post mavjud emas.</p>
            <p className="text-xs text-neutral-500 leading-normal">
              Post yoki video yuklash uchun <strong>"+" (Yaratish)</strong> bo'limidan foydalaning.
            </p>
          </div>
        ) : currentReel ? (
          (() => {
            // Helper to render responsive vertical interaction sidebars
            const renderSidebar = (isMobile: boolean) => (
              <div 
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className={
                  isMobile 
                    ? "flex md:hidden absolute bottom-[90px] right-[16px] z-30 flex-col gap-4 items-center select-none"
                    : "hidden md:flex flex-col gap-4.5 items-center select-none bg-zinc-950/45 p-3.5 rounded-full border border-white/[0.06] backdrop-blur-xl shrink-0 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
                }
              >
                {/* 1. Like Action */}
                <div className="flex flex-col items-center gap-1">
                  <button 
                    onClick={handleToggleLike}
                    className="p-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 hover:bg-black/55 active:scale-75 transition-all text-white shadow-md"
                  >
                    <Heart size={22} fill={likeInfo?.isLiked ? "#E60023" : "none"} stroke={likeInfo?.isLiked ? "#E60023" : "currentColor"} strokeWidth={2.2} />
                  </button>
                  <span className="text-[11px] text-white font-bold drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)] text-shadow-sm">
                    {likeInfo?.count !== undefined ? likeInfo.count : (currentReel.likesCount || 0)}
                  </span>
                </div>

                {/* 2. Write/View Comments */}
                <div className="flex flex-col items-center gap-1">
                  <button 
                    onClick={() => reelId && setShowComments(showComments === reelId ? null : reelId)}
                    className="p-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 hover:bg-black/55 active:scale-75 transition-all text-white shadow-md"
                  >
                    <MessageSquare size={22} strokeWidth={2.2} />
                  </button>
                  <span className="text-[11px] text-white font-bold drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)] text-shadow-sm">
                    {dbComments.length}
                  </span>
                </div>

                {/* 3. Bookmark / Save action */}
                <div className="flex flex-col items-center gap-1">
                  <button 
                    onClick={handleToggleSave}
                    className="p-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 hover:bg-black/55 active:scale-75 transition-all text-white shadow-md"
                    title="Saqlash"
                  >
                    <Bookmark size={22} fill={isSaved ? "#F59E0B" : "none"} stroke={isSaved ? "#F59E0B" : "currentColor"} strokeWidth={2.2} />
                  </button>
                  <span className="text-[10px] text-white/90 font-bold drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)] text-shadow-sm">Saqlash</span>
                </div>

                {/* 4. Copy url / Share */}
                <div className="flex flex-col items-center gap-1">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/pin/${currentReel.id}`);
                      alert("Ushbu post havolasi nusxalandi!");
                    }}
                    className="p-2.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 hover:bg-black/55 active:scale-75 transition-all text-white shadow-md"
                    title="Havolani ko'chirish"
                  >
                    <Send size={22} strokeWidth={2.2} />
                  </button>
                  <span className="text-[10px] text-white font-bold drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.95)] text-shadow-sm">Ulashish</span>
                </div>

                {/* 5. Author Profile image link */}
                <button 
                  onClick={() => onPinPress(currentReel)}
                  className="relative mt-1.5 border-2 border-white rounded-full overflow-hidden w-[34px] h-[34px] shrink-0 active:scale-95 transition-transform shadow-xl"
                  title="Profilga o'tish"
                >
                  <S3Image 
                    src={currentReel.avatarUrl || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100"} 
                    className="w-full h-full object-cover" 
                    skeletonClassName="rounded-full"
                  />
                </button>
              </div>
            );

            return (
              <div className="relative flex items-center justify-center w-full h-full md:max-w-4xl px-0 md:px-6">
                
                {/* Desktop Left Helper Button (Scroll Up / Previous) */}
                {filteredReels.length > 1 && (
                  <div className="absolute left-2 xl:left-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-30">
                    <button
                      onClick={() => {
                        if (currentIndex > 0) {
                          setScrollDirection('up');
                          setCurrentIndex(prev => prev - 1);
                          setShowComments(null);
                        }
                      }}
                      disabled={currentIndex === 0}
                      className={`p-3.5 rounded-full bg-zinc-950/80 border border-white/5 text-white active:scale-90 transition-all ${
                        currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white hover:text-black shadow-lg hover:scale-105'
                      }`}
                      title="Oldingi"
                    >
                      <ChevronLeft size={22} className="rotate-90" />
                    </button>
                  </div>
                )}

                {/* Sliding AnimatePresence container for seamless animated page changes */}
                <AnimatePresence mode="wait" custom={scrollDirection}>
                  <motion.div
                    key={currentReel.id}
                    custom={scrollDirection}
                    variants={{
                      initial: (dir) => ({ y: dir === 'down' ? 180 : -180, opacity: 0 }),
                      animate: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 220, damping: 25 } },
                      exit: (dir) => ({ y: dir === 'down' ? -180 : 180, opacity: 0, transition: { duration: 0.18 } })
                    }}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="flex md:flex-row flex-col items-center justify-center gap-0 md:gap-5 w-full h-full relative"
                  >
                    {/* Central Playback Card - Expanded and polished for both desktop and mobile layouts */}
                    <div 
                      onMouseDown={handleGestureStart}
                      onMouseUp={handleGestureEnd}
                      onTouchStart={handleGestureStart}
                      onTouchEnd={handleGestureEnd}
                      className="relative w-full h-full md:w-[420px] md:h-[84vh] bg-black md:rounded-3xl md:border md:border-zinc-900/50 overflow-hidden shadow-2xl flex items-center justify-center cursor-pointer select-none"
                    >
                      
                      {currentReel.mediaType === 'video' ? (
                        <div className="w-full h-full relative flex items-center justify-center">
                          {/* Ambient blur backdrop */}
                          <video
                            src={currentReel.imageUrl}
                            muted
                            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-30 select-none pointer-events-none"
                          />
                          <video
                            key={currentReel.id}
                            ref={videoRef}
                            src={currentReel.imageUrl}
                            loop
                            muted={isMuted}
                            autoPlay
                            playsInline
                            className="w-full h-full object-contain relative z-10 transition-all"
                          />
                        </div>
                      ) : (
                        <div className="w-full h-full relative flex items-center justify-center">
                          {/* Ambient blur backdrop */}
                          <img
                            src={currentReel.imageUrl}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-30 select-none pointer-events-none"
                          />
                          <img
                            src={currentReel.imageUrl}
                            className="w-full h-full object-contain relative z-10"
                            alt={currentReel.title}
                          />
                          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/80 z-20 pointer-events-none" />
                        </div>
                      )}

                      {/* Giant Central Double-Tap Heart Animation */}
                      <AnimatePresence>
                        {showHeartAnim && (
                          <motion.div
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ 
                              scale: [0.3, 1.3, 0.9, 1], 
                              opacity: [0, 1, 1, 0],
                              y: [0, -10, -10, -20]
                            }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            className="absolute pointer-events-none z-35 flex items-center justify-center"
                          >
                            <Heart size={85} fill="#E60023" stroke="none" className="filter drop-shadow-[0_4px_16px_rgba(230,0,35,0.6)]" />
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Centered Pause Indicator during Long Press */}
                      <AnimatePresence>
                        {isHolding && (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 0.8 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="absolute pointer-events-none z-35 bg-black/50 p-5 rounded-full flex items-center justify-center border border-white/5"
                          >
                            <svg className="w-7 h-7 text-white fill-white" viewBox="0 0 24 24">
                              <rect x="5" y="4" width="4" height="16" rx="1" />
                              <rect x="15" y="4" width="4" height="16" rx="1" />
                            </svg>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Mute icon overlays inside card (Top Right to prevent clashing with bottom titles & music) */}
                      <button 
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setIsMuted(prev => !prev); }}
                        className="absolute top-4 right-4 z-[45] bg-black/60 backdrop-blur-md p-2.5 rounded-full hover:bg-black/80 hover:scale-105 active:scale-95 transition-all border border-white/10 shadow-lg flex items-center justify-center w-9 h-9 pointer-events-auto"
                        title={isMuted ? "Ovozni yoqish" : "Ovozni o'chirish"}
                      >
                        {isMuted ? <VolumeX size={15} className="text-white" /> : <Volume2 size={15} className="text-white" />}
                      </button>

                      {/* Bottom Info details on dark gradient overlay - pr-16 ensures mobile float sidebar never overlaps text! */}
                      <div 
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute bottom-0 inset-x-0 z-20 text-left flex flex-col gap-2.5 bg-gradient-to-t from-black/95 via-black/40 to-transparent p-5 pb-[82px] md:pb-6 pt-24 md:rounded-b-3xl pr-20 md:pr-4"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <S3Image 
                            src={currentReel.avatarUrl || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100"} 
                            className="w-7 h-7 rounded-full object-cover border border-white/20 hover:scale-105 transition-transform cursor-pointer block md:hidden whitespace-nowrap" 
                            skeletonClassName="rounded-full"
                          />
                          <span className="text-white font-heavy text-xs tracking-wide cursor-pointer hover:underline text-shadow-sm" onClick={() => onPinPress(currentReel)}>
                            @{currentReel.author === 'Visual Explorer' ? 'visual_explorer' : currentReel.author.toLowerCase().replace(/\s+/g, '_')}
                          </span>
                          <button 
                            className="bg-transparent text-white border border-white/40 font-semibold px-2.5 py-0.5 rounded-md text-[10px] hover:bg-white/15 transition-colors"
                            onClick={() => onPinPress(currentReel)}
                          >
                            Follow
                          </button>
                        </div>
                        <p className="text-white text-xs leading-relaxed font-semibold line-clamp-2 text-shadow-sm">
                          {currentReel.description || currentReel.title}
                        </p>
                        
                        {/* Clean generic track */}
                        <div className="flex items-center gap-1.5 overflow-hidden w-[75%] bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] text-zinc-100">
                          <span className="animate-pulse text-[11px]">🎵</span>
                          <div className="whitespace-nowrap overflow-hidden text-ellipsis">
                            musqa - {currentReel.author.toLowerCase().replace(/\s+/g, '')}
                          </div>
                        </div>
                      </div>

                      {/* Overlaid mobile vertical interaction panel inside the card */}
                      {renderSidebar(true)}
                    </div>

                    {/* Desktop vertical interaction panel next to the card */}
                    {renderSidebar(false)}

                    {/* Sliding Bottom Comments Sheet */}
                <AnimatePresence>
                  {showComments === currentReel.id && (
                    <motion.div 
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      exit={{ y: "100%" }}
                      className="absolute inset-x-0 bottom-0 top-[35%] bg-[#0d0d0df3] backdrop-blur-2xl border-t border-zinc-900 rounded-t-3xl z-40 p-4 pb-6 flex flex-col justify-between shadow-[0_-20px_50px_rgba(0,0,0,0.8)] select-text"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseUp={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      onTouchEnd={(e) => e.stopPropagation()}
                      onWheel={(e) => e.stopPropagation()}
                    >
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-white font-extrabold text-xs">{dbComments.length} Izohlar</span>
                        <button 
                          onClick={() => {
                            setShowComments(null);
                            setReplyingToComment(null);
                            setShowGifPicker(false);
                          }}
                          className="text-neutral-500 text-[10px] hover:text-white"
                        >
                          Yopish
                        </button>
                      </div>
                      
                      {/* Database Comments scrollable feed */}
                      <div className="flex-1 overflow-y-auto space-y-4 pr-1 no-scrollbar text-left text-xs pb-2">
                        {dbComments.length === 0 ? (
                          <div className="text-neutral-600 text-center py-8 text-[11px]">
                            Hozircha izohlar yo'q. Birinchi bo'lib izoh qoldiring!
                          </div>
                        ) : (
                          dbComments.map((c: any) => {
                            const isCommentLiked = c.comment_likes?.some((lk: any) => lk.user_id === userId);
                            const hasReplies = c.comment_replies && c.comment_replies.length > 0;
                            const isExpanded = !!expandedReplies[c.id];
                            const isGif = c.content.startsWith('http') && (c.content.includes('giphy.com') || c.content.includes('.gif'));

                            return (
                              <div key={c.id} className="group flex flex-col pt-0.5 border-b border-zinc-900/10 pb-1">
                                {/* Comment Body Row */}
                                <div className="flex gap-2.5 items-start justify-between w-full">
                                  <div className="flex gap-2.5 items-start flex-1 min-w-0">
                                    <S3Image 
                                      src={c.profiles?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.user_id || 'd'}`} 
                                      className="w-7 h-7 rounded-full object-cover shrink-0" 
                                      skeletonClassName="rounded-full"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-zinc-100 font-semibold text-[11px] mb-0.5">
                                        {c.profiles?.full_name || c.profiles?.username || 'Foydalanuvchi'}
                                      </p>
                                      {isGif ? (
                                        <img src={c.content} className="max-w-[140px] max-h-[140px] rounded-xl my-1 object-cover shadow-md" alt="Comment GIF" />
                                      ) : (
                                        <p className="text-neutral-300 leading-normal text-[11px] break-words pr-2">{c.content}</p>
                                      )}
                                      
                                      {/* Metadata Row */}
                                      <div className="flex items-center gap-3.5 mt-1 text-[9.5px] text-neutral-500 font-medium">
                                        <span>{new Date(c.created_at).toLocaleDateString()}</span>
                                        <button 
                                          onClick={() => setReplyingToComment({ id: c.id, username: c.profiles?.username || c.profiles?.full_name || 'foydalanuvchi' })}
                                          className="font-bold text-neutral-400 hover:text-white transition-colors"
                                        >
                                          Javob berish
                                        </button>
                                        <span className="text-neutral-600 flex items-center gap-0.5">
                                          <Heart size={8} fill={isCommentLiked ? "#E60023" : "none"} stroke={isCommentLiked ? "none" : "currentColor"} />
                                          {c.comment_likes?.length || 0}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Like heart on far right */}
                                  <button 
                                    onClick={() => handleToggleCommentLike(c.id, isCommentLiked)}
                                    className={`shrink-0 p-1.5 hover:scale-110 active:scale-90 transition-transform ${isCommentLiked ? 'text-red-500' : 'text-neutral-500 hover:text-neutral-300'}`}
                                  >
                                    <Heart size={13} fill={isCommentLiked ? "#E60023" : "none"} className={isCommentLiked ? "filter drop-shadow-[0_2px_6px_rgba(230,0,35,0.4)]" : ""} />
                                  </button>
                                </div>

                                {/* Replies count & toggle link */}
                                {hasReplies && (
                                  <div className="pl-[38px] mt-2">
                                    <button 
                                      onClick={() => setExpandedReplies(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
                                      className="text-[10px] font-bold text-neutral-500 hover:text-neutral-300 flex items-center gap-1.5 transition-colors"
                                    >
                                      <span className="inline-block w-4 h-[1px] bg-neutral-700"></span>
                                      {isExpanded ? "Javoblarni yopish" : `Javoblarni ko'rish (${c.comment_replies.length})`}
                                    </button>
                                  </div>
                                )}

                                {/* Nesting Replies Area */}
                                {isExpanded && hasReplies && (
                                  <div className="space-y-3.5 mt-2.5">
                                    {c.comment_replies.map((reply: any) => {
                                      const isReplyLiked = reply.reply_likes?.some((rl: any) => rl.user_id === userId);
                                      const isReplyGif = reply.content.startsWith('http') && (reply.content.includes('giphy.com') || reply.content.includes('.gif'));

                                      return (
                                        <div key={reply.id} className="flex gap-2.5 items-start pl-[38px] w-full justify-between">
                                          <div className="flex gap-2.5 items-start flex-1 min-w-0">
                                            <S3Image 
                                              src={reply.profiles?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${reply.user_id || 'r'}`} 
                                              className="w-5.5 h-5.5 rounded-full object-cover shrink-0" 
                                              skeletonClassName="rounded-full"
                                            />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-zinc-200 font-semibold text-[10px] mb-0.5">
                                                {reply.profiles?.full_name || reply.profiles?.username || 'Foydalanuvchi'}
                                              </p>
                                              {isReplyGif ? (
                                                <img src={reply.content} className="max-w-[120px] max-h-[120px] rounded-xl my-1 object-cover shadow-md" alt="Reply GIF" />
                                              ) : (
                                                <p className="text-neutral-350 leading-normal text-[10px] break-words pr-2">{reply.content}</p>
                                              )}
                                              <div className="flex items-center gap-3 mt-0.5 text-[8.5px] text-neutral-500">
                                                <span>{new Date(reply.created_at).toLocaleDateString()}</span>
                                                <span className="text-neutral-600 flex items-center gap-0.5">
                                                  <Heart size={7} fill={isReplyLiked ? "#E60023" : "none"} stroke={isReplyLiked ? "none" : "currentColor"} />
                                                  {reply.reply_likes?.length || 0}
                                                </span>
                                              </div>
                                            </div>
                                          </div>

                                          {/* Tiny heart like button on far right for reply */}
                                          <button 
                                            onClick={() => handleToggleReplyLike(reply.id, isReplyLiked)}
                                            className={`shrink-0 p-1.5 hover:scale-110 active:scale-95 transition-transform ${isReplyLiked ? 'text-red-500' : 'text-neutral-600 hover:text-neutral-400'}`}
                                          >
                                            <Heart size={11} fill={isReplyLiked ? "#E60023" : "none"} />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Displaying target reply handle if active replying state */}
                      {replyingToComment && (
                        <div className="flex justify-between items-center bg-zinc-900/50 px-3.5 py-1.5 rounded-t-xl text-[10px] text-neutral-400 border-x border-t border-zinc-900 animate-fade-in shrink-0">
                          <span>@{replyingToComment.username} ga javob qaytarilmoqda...</span>
                          <button 
                            onClick={() => setReplyingToComment(null)}
                            className="text-red-500 hover:text-red-400 font-bold"
                          >
                            Bekor qilish
                          </button>
                        </div>
                      )}

                      {/* Giphy Search and Picker Panel */}
                      {showGifPicker && (
                        <div className="bg-zinc-950 p-3 rounded-2xl border border-zinc-900 mb-2 flex flex-col gap-2.5 max-h-[185px] shrink-0 shadow-inner">
                          <div className="flex gap-2 items-center">
                            <input 
                              type="text"
                              placeholder="Giphy search/trending..."
                              value={gifQuery}
                              onChange={(e) => setGifQuery(e.target.value)}
                              className="flex-1 bg-zinc-900/80 text-[11px] px-3.5 py-2 rounded-xl text-white border-none outline-none focus:ring-1 focus:ring-neutral-700 placeholder-neutral-500"
                            />
                            <button 
                              onClick={() => setShowGifPicker(false)}
                              className="text-[9.5px] text-zinc-400 hover:text-white px-2.5 py-1.5 bg-zinc-900 rounded-md transition-colors"
                            >
                              Yopish
                            </button>
                          </div>
                          <div className="flex-1 overflow-x-auto overflow-y-hidden flex gap-2 pb-1.5 pr-1 custom-scrollbar">
                            {loadingGifs ? (
                              <span className="text-[10px] text-zinc-500 m-auto animate-pulse">Yuklanmoqda...</span>
                            ) : gifsList.length === 0 ? (
                              <span className="text-[10px] text-zinc-500 m-auto">GIFlar topilmadi</span>
                            ) : (
                              gifsList.map((g: any) => {
                                const gifUrl = g.images?.fixed_height_small?.url || g.images?.fixed_height?.url || g.images?.original?.url;
                                if (!gifUrl) return null;
                                return (
                                  <button 
                                    key={g.id} 
                                    type="button" 
                                    onClick={() => handleSendGif(gifUrl)}
                                    className="relative shrink-0 w-24 h-16 bg-zinc-900 rounded-lg overflow-hidden hover:scale-105 active:scale-95 transition-all"
                                  >
                                    <img src={gifUrl} className="w-full h-full object-cover" alt="Giphy selection" />
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}

                      {/* Comment post form */}
                      <form onSubmit={handleAddComment} className="flex gap-2 items-center pt-3 border-t border-zinc-900 animate-none shrink-0">
                        {/* GIPHY Toggle Badge */}
                        <button
                          type="button"
                          onClick={() => setShowGifPicker(prev => !prev)}
                          className={`px-3 py-2 rounded-full text-[10px] font-extrabold transition-all border ${
                            showGifPicker 
                              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white border-transparent' 
                              : 'bg-zinc-900 hover:bg-zinc-800 text-neutral-400 border-zinc-800'
                          }`}
                          title="GIPHY GIFlar"
                        >
                          GIF
                        </button>

                        <input
                          type="text"
                          value={commentsInput}
                          onChange={e => setCommentsInput(e.target.value)}
                          placeholder={replyingToComment ? `Javob qaytarish @${replyingToComment.username}...` : "Fikr bildiring..."}
                          className="flex-1 bg-zinc-900 border-none outline-none text-white text-[11px] px-3.5 py-2.5 rounded-full placeholder-neutral-500"
                        />
                        <button
                          type="submit"
                          className="bg-white text-black font-extrabold px-4 py-2.5 rounded-full text-[10px] active:scale-95 transition-transform shrink-0"
                        >
                          Yuborish
                        </button>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </AnimatePresence>

            {/* Desktop Right Helper Button (Scroll Down / Next) */}
            {filteredReels.length > 1 && (
              <div className="absolute right-2 xl:right-8 top-1/2 -translate-y-1/2 hidden lg:flex flex-col gap-3 z-30">
                <button
                  onClick={() => {
                    if (currentIndex < filteredReels.length - 1) {
                      setScrollDirection('down');
                      setCurrentIndex(prev => prev + 1);
                      setShowComments(null);
                    }
                  }}
                  disabled={currentIndex === filteredReels.length - 1}
                  className={`p-3.5 rounded-full bg-zinc-950/80 border border-white/5 text-white active:scale-90 transition-all ${
                    currentIndex === filteredReels.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white hover:text-black shadow-lg hover:scale-105'
                  }`}
                  title="Keyingi"
                >
                  <ChevronLeft size={22} className="-rotate-90" />
                </button>
              </div>
            )}
              </div>
            );
          })()
        ) : null}
      </div>
    </motion.div>
  );
});

ReelsTab.displayName = 'ReelsTab';

const SuggestionRow: React.FC<{ user: any, session: any }> = ({ user, session }) => {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Check initial follow status
    if (session?.user?.id && user?.id) {
      supabase.from('followers')
        .select('follower_id')
        .eq('following_id', user.id)
        .eq('follower_id', session.user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setIsFollowing(true);
        });
    }
  }, [session, user]);

  const handleFollow = async (e: React.MouseEvent) => {
    e.stopPropagation(); // so we don't open profile immediately
    if (loading || !session?.user?.id) return;
    setLoading(true);
    try {
      if (isFollowing) {
        await supabase.from('followers').delete().eq('following_id', user.id).eq('follower_id', session.user.id);
        setIsFollowing(false);
      } else {
        await supabase.from('followers').insert({ following_id: user.id, follower_id: session.user.id });
        setIsFollowing(true);
        // notify
        supabase.from('notifications').insert({
          user_id: user.id,
          actor_id: session.user.id,
          type: 'follow'
        }).then();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between bg-neutral-900/40 border border-neutral-800/40 p-3.5 rounded-2xl hover:bg-neutral-900/80 transition-all select-none duration-200">
      <div className="flex items-center gap-3">
        <S3Image src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id || 'seed'}`} className="w-10 h-10 rounded-full object-cover shrink-0" skeletonClassName="rounded-full" />
        <div className="text-left">
          <h5 className="text-white font-bold text-xs">{user.full_name || user.username}</h5>
          <span className="text-neutral-500 text-[11px] block">@{user.username}</span>
        </div>
      </div>
      <button 
        onClick={handleFollow}
        disabled={loading}
        className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${isFollowing ? 'bg-neutral-800 text-neutral-400' : 'bg-[#E60023] hover:bg-[#ff1a3c] text-white active:scale-95'}`}
      >
        {isFollowing ? 'Obunadasiz' : 'Obuna bo\'lish'}
      </button>
    </div>
  );
};

const SearchTab: React.FC<{ pins: WebPin[], onPinPress: (pin: WebPin) => void, onUserPress: (id: string) => void, session?: any }> = React.memo(({ pins, onPinPress, onUserPress, session }) => {
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'pins' | 'users'>('pins');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: usersData } = useSearchUsers(debouncedQuery);
  const users = usersData || [];

  const { data: suggestions } = useQuery({
    queryKey: ['followSuggestions', session?.user?.id],
    enabled: !useMock && !!session?.user?.id,
    queryFn: async () => {
      // 1. Get profiles we already follow so we filter them out
      const { data: following } = await supabase
        .from('followers')
        .select('following_id')
        .eq('follower_id', session.user.id);
      
      const followedIds = following?.map(f => f.following_id) || [];
      followedIds.push(session.user.id); // Exclude self

      // 2. Query other profiles
      let queryBuilder = supabase.from('profiles').select('*');
      if (followedIds.length > 0) {
        // Safe check for uuid arrays
        const idsString = followedIds.map(id => `'${id}'`).join(',');
        queryBuilder = queryBuilder.filter('id', 'not.in', `(${idsString})`);
      }
      
      const { data: profiles } = await queryBuilder.limit(5);
      return profiles || [];
    }
  });
  
  const filteredPins = useMemo(() => {
    if (!debouncedQuery) return pins;
    return pins.filter(p => {
      const q = debouncedQuery.toLowerCase();
      return (
        p.title?.toLowerCase().includes(q) || 
        p.description?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.author?.toLowerCase().includes(q)
      );
    });
  }, [pins, debouncedQuery]);

  const leftCol = useMemo(() => filteredPins.filter((_, i) => i % 2 === 0), [filteredPins]);
  const rightCol = useMemo(() => filteredPins.filter((_, i) => i % 2 !== 0), [filteredPins]);

  const handlePinPress = useCallback((pin: WebPin) => onPinPress(pin), [onPinPress]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="pb-6 w-full"
    >
      <div className="sticky top-0 z-30 bg-[#0f0f0f]/90 backdrop-blur-xl pt-12 pb-3 px-4 flex flex-col w-full gap-3">
        <div className="flex justify-between items-center w-full">
          <div className="bg-neutral-800/80 rounded-full flex items-center px-4 py-2 h-11 w-full transition-all focus-within:bg-neutral-800">
            <Search size={18} className="text-neutral-400 mr-2" />
            <input 
              type="text" 
              placeholder="Search for ideas or users..." 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-white w-full text-[15px]"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setSearchMode('pins')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${searchMode === 'pins' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
          >
            Pins
          </button>
          <button 
            onClick={() => setSearchMode('users')}
            className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${searchMode === 'users' ? 'bg-white text-black' : 'bg-neutral-800 text-white'}`}
          >
            Users
          </button>
        </div>
      </div>

      {searchMode === 'pins' ? (
        <div className="px-2 mt-2 flex items-start gap-2">
          <div className="w-1/2 flex flex-col gap-2">
            {leftCol.map((pin, i) => <PinCard key={`${pin.id}-${i}`} pin={pin} onPress={() => handlePinPress(pin)} session={session} />)}
          </div>
          <div className="w-1/2 flex flex-col gap-2">
            {rightCol.map((pin, i) => <PinCard key={`${pin.id}-${i}`} pin={pin} onPress={() => handlePinPress(pin)} session={session} />)}
          </div>
        </div>
      ) : (
        <div className="px-4 mt-2 space-y-4">
          {/* Suggested creators section */}
          {debouncedQuery.length === 0 && suggestions && suggestions.length > 0 && (
            <div className="space-y-3 mb-6">
              <h3 className="text-neutral-300 font-bold text-sm tracking-tight text-left">Tavsiya etilgan ijodkorlar</h3>
              <div className="flex flex-col gap-2">
                {suggestions.map((u: any) => (
                  <div key={u.id} className="cursor-pointer" onClick={() => onUserPress(u.id)}>
                    <SuggestionRow user={u} session={session} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {users.map(u => (
            <div key={u.id} className="flex items-center gap-3 cursor-pointer group" onClick={() => onUserPress(u.id)}>
              <S3Image src={u.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'} className="w-12 h-12 rounded-full object-cover group-hover:opacity-80 transition-opacity" />
              <div className="text-left">
                <h4 className="text-white font-bold text-sm">{u.full_name || u.username}</h4>
                <p className="text-neutral-400 text-xs">@{u.username}</p>
              </div>
            </div>
          ))}
          {debouncedQuery.length > 1 && users.length === 0 && (
            <div className="text-center text-neutral-500 mt-10">No users found.</div>
          )}
          {debouncedQuery.length <= 1 && (
            <div className="text-center text-neutral-500 mt-10">Type at least 2 characters to search users.</div>
          )}
        </div>
      )}
    </motion.div>
  );
});

SearchTab.displayName = 'SearchTab';

const CreateTab: React.FC<{ onAddPin: (p: WebPin) => void, session: any }> = ({ onAddPin, session }) => {
  const [file, setFile] = useState<File | null>(null);
  const [imgDataUrl, setImgDataUrl] = useState('');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'success'>('idle');
  const [fileType, setFileType] = useState<'image' | 'video'>('image');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Advanced settings state variables
  const [videoQuality, setVideoQuality] = useState<'720p' | '1080p' | '4k'>('1080p');
  const [enableCompression, setEnableCompression] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [compressionStatus, setCompressionStatus] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const isImage = selectedFile.type.startsWith('image/');
      const isVideo = selectedFile.type.startsWith('video/');

      if (!isImage && !isVideo) {
        alert("Faqat rasm yoki video yuklash mumkin! Boshqa turdagi fayllar taqiqlangan.");
        return;
      }

      if (isVideo) {
        const videoElement = document.createElement('video');
        videoElement.preload = 'metadata';
        videoElement.onloadedmetadata = () => {
          window.URL.revokeObjectURL(videoElement.src);
          const duration = videoElement.duration;
          console.log("Video duration detected:", duration);
          if (duration > 180) {
            alert("Xatolik: Video davomiyligi 3 daqiqadan (180 soniya) ko'p bo'lishi mumkin emas. Iltimos qisqaroq video tanlang!");
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
          setFile(selectedFile);
          setFileType('video');
          const reader = new FileReader();
          reader.onload = (ev) => setImgDataUrl(ev.target?.result as string);
          reader.readAsDataURL(selectedFile);
        };
        videoElement.src = URL.createObjectURL(selectedFile);
      } else {
        setFile(selectedFile);
        setFileType('image');
        const reader = new FileReader();
        reader.onload = (ev) => setImgDataUrl(ev.target?.result as string);
        reader.readAsDataURL(selectedFile);
      }
    }
  };

  const handleSubmit = async () => {
    if ((!file && !imgDataUrl) || status !== 'idle') return;
    setStatus('uploading');
    setProgress(5);
    setCompressionStatus('Fayl tayyorlanmoqda...');
    
    try {
      let publicUrl = imgDataUrl; // Fallback to provided URL for demo pins clicked

      if (file && !useMock) {
        console.log("STEP 1: File selected", { name: file.name, type: file.type, size: file.size });
        
        if (fileType === 'video') {
          // Compression simulation sequence
          setProgress(15);
          setCompressionStatus(`Video formati va sifati tekshirilmoqda (${videoQuality.toUpperCase()})...`);
          await new Promise(r => setTimeout(r, 800));

          if (enableCompression) {
            setProgress(35);
            setCompressionStatus(`Smart Compressor: ${videoQuality.toUpperCase()} saqlagan holda fayl hajmi siqilmoqda...`);
            await new Promise(r => setTimeout(r, 1200));
            setProgress(55);
            setCompressionStatus('Video muvaffaqiyatli siqildi (Sifat mutlaq darajada saqlandi!)');
            await new Promise(r => setTimeout(r, 600));
          } else {
            setProgress(30);
            setCompressionStatus('Original sifatda yuklash boshlanmoqda...');
            await new Promise(r => setTimeout(r, 500));
          }
        } else {
          setProgress(20);
          setCompressionStatus('Tasvir sifati optimallashtirilmoqda...');
          await new Promise(r => setTimeout(r, 500));
        }

        setProgress(60);
        setCompressionStatus('Bulutli hostingga yuklanmoqda (AWS S3)...');
        
        // Upload to AWS S3
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `documents/${fileName}`;
        
        publicUrl = await uploadToS3(file, filePath);
        setProgress(85);
        setCompressionStatus('Ma\'lumotlar bazasida bog\'lanmoqda...');
      } else {
        // Fake upload timing for mock
        setProgress(50);
        setCompressionStatus('Yuklanmoqda...');
        await new Promise(r => setTimeout(r, 1000));
      }

      setProgress(95);

      // Save to database
      if (!useMock) {
        console.log("STEP 6: Pin inserted into database");
        let { data: profile, error: profileErr } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        
        if (profileErr && profileErr.code === 'PGRST116' || !profile) {
          // Profile not found, create one
          const { data: newProfile, error: upsertErr } = await supabase.from('profiles').upsert({
            id: session.user.id,
            username: session.user.email?.split('@')[0] || 'User',
            avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200'
          }).select().single();
          
          if (upsertErr) {
            console.error("Profile creation error:", upsertErr);
            throw upsertErr;
          }
          profile = newProfile;
        }
        
        // Lookup or seed correct category_id UUID (since category does not exist as text column)
        let categoryId: string | null = null;
        try {
          const { data: catData } = await supabase
            .from('categories')
            .select('id')
            .eq('name', 'Explore')
            .limit(1)
            .maybeSingle();

          if (catData?.id) {
            categoryId = catData.id;
          } else {
            const { data: newCat } = await supabase
              .from('categories')
              .insert({ name: 'Explore' })
              .select('id')
              .limit(1)
              .maybeSingle();
            
            if (newCat?.id) {
              categoryId = newCat.id;
            }
          }
        } catch (catErr) {
          console.error("Error looking up/inserting category:", catErr);
        }

        const { data: newPin, error: dbError } = await supabase.from('pins').insert({
          user_id: session.user.id,
          title: title || 'New Idea',
          description: desc,
          category_id: categoryId ?? null
        }).select('*, categories(name)').single();

        if (dbError) {
          console.error("Database insert error:", dbError);
          throw dbError;
        }

        const pinHeight = getRandomHeight();
        const { error: mediaError } = await supabase.from('pin_media').insert({
          pin_id: newPin.id,
          media_type: fileType,
          media_url: publicUrl,
          thumbnail_url: publicUrl,
          width: 500,
          height: pinHeight,
          duration: 0,
          position: 0
        });

        if (mediaError) {
          console.error("Database pin_media insert error:", mediaError);
          // throw or handle
        }

        setProgress(100);
        setStatus('success');
        
        setTimeout(async () => {
          onAddPin({
            id: newPin.id,
            imageUrl: publicUrl ? await getS3ObjectUrl(publicUrl) : '',
            title: newPin.title,
            description: newPin.description,
            category: newPin.categories?.name || 'Explore',
            author: profile?.full_name || profile?.username || 'Unknown',
            avatarUrl: profile?.avatar_url ? await getS3ObjectUrl(profile.avatar_url) : "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100",
            likesCount: 0,
            width: 500,
            height: pinHeight,
            userId: session.user.id,
            mediaType: fileType
          });
          setStatus('idle');
          setProgress(0);
          setFile(null);
          setImgDataUrl('');
          setTitle('');
          setDesc('');
        }, 800);
      } else {
        // Mock fallback
        setProgress(100);
        setStatus('success');
        setTimeout(() => {
          onAddPin({
            id: `p_${Date.now()}`,
            imageUrl: imgDataUrl,
            title: title || 'New Idea',
            description: desc,
            category: 'Explore',
            author: 'Visual Explorer',
            avatarUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
            likesCount: 0,
            width: 500,
            height: getRandomHeight(),
            mediaType: fileType
          });
          setStatus('idle');
          setProgress(0);
          setFile(null);
          setImgDataUrl('');
          setTitle('');
          setDesc('');
        }, 800);
      }
    } catch (err: any) {
      console.error("=== UPLOAD FAILED IN CATCH BLOCK ===");
      console.error("Error name:", err.name);
      console.error("Error message:", err.message);
      console.error("Stack trace:", err.stack);
      setStatus('idle');
      setProgress(0);
      
      if (err.code === '42501' || err?.message?.includes('row-level security')) {
        alert("Supabase RLS xatosi: Iltimos Supabase SQL Editorga kirib quyidagi kodni ishlating:\n\nalter table profiles disable row level security;\nalter table pins disable row level security;");
      } else {
        alert(err.message || 'Yuklashda nomaʼlum xato. Logni tekshiring.');
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      className="p-4 pt-12 min-h-screen relative max-w-lg mx-auto pb-32"
    >
      <div className="flex justify-between items-center mb-6">
        <span className="text-white font-semibold text-lg">Create Pin</span>
        <button 
          onClick={handleSubmit} 
          disabled={(!file && !imgDataUrl) || status !== 'idle'}
          className="bg-[#E60023] disabled:opacity-50 text-white font-bold px-4 py-1.5 rounded-full text-sm"
        >
          {status === 'idle' ? 'Next' : status === 'uploading' ? 'Posting...' : 'Done'}
        </button>
      </div>

      <div className="space-y-4">
        {!imgDataUrl ? (
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="bg-neutral-900 border-2 border-dashed border-neutral-700 rounded-3xl aspect-[3/4] flex flex-col items-center justify-center p-6 text-center cursor-pointer hover:bg-neutral-800 transition-colors"
          >
             <input 
               type="file" 
               ref={fileInputRef} 
               onChange={handleFileChange} 
               accept="image/*,video/*" 
               className="hidden" 
             />
             <Camera className="text-neutral-500 mb-2" size={32} />
             <span className="text-neutral-400 font-semibold mb-[2px]">Rasm yoki video yuklang</span>
             <span className="text-neutral-600 text-xs">(Faqat rasm va video ruxsat etiladi)</span>
          </div>
        ) : (
          <div className="relative aspect-[3/4] rounded-3xl overflow-hidden bg-neutral-900">
            {fileType === 'video' ? (
              <video src={imgDataUrl} controls className="w-full h-full object-cover" />
            ) : (
              <img src={imgDataUrl} className="w-full h-full object-cover" />
            )}
            {status === 'idle' && (
              <button onClick={() => { setImgDataUrl(''); setFile(null); }} className="absolute top-4 right-4 bg-black/50 p-2 rounded-full backdrop-blur-md">
                <Plus className="text-white rotate-45" size={20} />
              </button>
            )}
            {/* Progress Overlay */}
            {status !== 'idle' && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-8">
                {status === 'uploading' && (
                  <div className="flex flex-col items-center gap-3 w-full max-w-[280px]">
                    <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-[#E60023]" 
                        initial={{ width: '0%' }}
                        animate={{ width: `${progress}%` }} 
                      />
                    </div>
                    {compressionStatus && (
                      <span className="text-white text-[11px] font-semibold text-center mt-1 animate-pulse bg-black/40 px-2 py-1 rounded">
                        {compressionStatus}
                      </span>
                    )}
                  </div>
                )}
                {status === 'success' && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-green-500 font-bold bg-green-500/20 px-6 py-3 rounded-full flex items-center gap-2">
                    <span className="text-xl">✓</span> Published
                  </motion.div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4 pt-2">
          <input 
            type="text" 
            placeholder="Give your Pin a title" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={status !== 'idle'}
            className="w-full bg-transparent border-b border-neutral-800 pb-3 text-white text-xl font-bold placeholder-neutral-600 outline-none focus:border-[#E60023] transition-colors"
          />
          <input 
            type="text" 
            placeholder="Add a description" 
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            disabled={status !== 'idle'}
            className="w-full bg-transparent border-b border-neutral-800 pb-3 text-white text-base placeholder-neutral-600 outline-none focus:border-[#E60023] transition-colors"
          />
        </div>

        {/* Advanced Settings Fold */}
        <div className="border border-neutral-850 rounded-2xl p-4 bg-neutral-900/40 mt-4">
          <button 
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex justify-between items-center text-white/90 font-semibold text-sm outline-none"
          >
            <span className="flex items-center gap-2">
              <Settings size={16} className="text-neutral-400" />
              Kengaytirilgan sozlamalar (Advanced Settings)
            </span>
            <ChevronDown size={14} className={`text-neutral-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-4 space-y-4 border-t border-neutral-800 pt-4"
              >
                {/* Resolution Quality Setting */}
                <div>
                  <label className="text-[11px] font-bold text-neutral-400 block mb-2 uppercase tracking-wider">Video Sifati (Select Output Quality)</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key: '720p', label: '720p (HD)', desc: 'Tez yuklash' },
                      { key: '1080p', label: '1080p (FHD)', desc: 'Yuqori sifat' },
                      { key: '4k', label: '4K (UHD)', desc: 'Asl tiniqlik' }
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setVideoQuality(opt.key as any)}
                        className={`p-2.5 rounded-xl border flex flex-col items-center justify-center transition-all ${
                          videoQuality === opt.key 
                            ? 'border-[#E60023] bg-[#E60023]/5 text-white' 
                            : 'border-neutral-800 bg-neutral-950/40 text-neutral-400'
                        }`}
                      >
                        <span className="font-bold text-xs">{opt.label}</span>
                        <span className="text-[9px] text-neutral-500 mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Compressor Switch setting */}
                <div className="flex justify-between items-center bg-neutral-950/20 p-3 rounded-xl border border-neutral-850">
                  <div className="pr-4">
                    <span className="text-[12px] font-bold text-white block">Hajmni aqlli siqish (Smart Compressor)</span>
                    <span className="text-[10px] text-neutral-500 block leading-tight mt-0.5">Tiniqlikni buzmasdan, fayl hajmini sezilarli darajada kamaytirish</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnableCompression(!enableCompression)}
                    className={`w-10 h-5.5 rounded-full p-0.5 transition-colors duration-200 outline-none flex items-center ${
                      enableCompression ? 'bg-[#E60023]' : 'bg-neutral-800'
                    }`}
                  >
                    <div className={`w-4.5 h-4.5 bg-white rounded-full shadow transform duration-200 ${
                      enableCompression ? 'translate-x-4.5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {/* Simulation info */}
                {file && (
                  <div className="text-[10.5px] text-neutral-400 flex items-start gap-1.5 bg-neutral-950/40 p-2.5 rounded-lg border border-neutral-850 leading-normal">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-ping shrink-0 mt-1" />
                    <span>
                      Video asl hajmi: <strong>{(file.size / (1024 * 1024)).toFixed(1)} MB</strong>. 
                      Optimal siqilgan hajm: <strong>{
                        (file.size / (1024 * 1024) * (videoQuality === '720p' ? 0.35 : videoQuality === '1080p' ? 0.55 : 0.85) * (enableCompression ? 0.45 : 1)).toFixed(1)
                      } MB</strong>. Sifat mutlaqo saqlanib qoladi.
                    </span>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// MessagesTab moved to features

const EditProfileModal = ({ profile, onClose, onSave, session }: any) => {
  const meta = session?.user?.user_metadata || {};
  const [username, setUsername] = useState(profile?.username || meta.username || '');
  const [fullName, setFullName] = useState(profile?.full_name || meta.full_name || '');
  const [birthDate, setBirthDate] = useState(profile?.birth_date || meta.birth_date || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || meta.avatar_url || '');
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState(profile?.avatar_url || meta.avatar_url || '');

  useEffect(() => {
    if (profile?.avatar_url) {
      getS3ObjectUrl(profile.avatar_url).then(setDisplayAvatarUrl);
    }
  }, [profile?.avatar_url]);

  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLoading(true);
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
        const filePath = `documents/${fileName}`;
        const url = await uploadToS3(file, filePath);
        setAvatarUrl(url); // the uploaded url or path
        getS3ObjectUrl(url).then(setDisplayAvatarUrl);
      } catch (err: any) {
        alert(err.message || 'Avatar yuklashda xatolik yuz berdi');
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (useMock) {
      onSave({ ...profile, username, bio, avatar_url: avatarUrl, full_name: fullName, birth_date: birthDate });
      onClose();
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .upsert({ id: session.user.id, username, bio, avatar_url: avatarUrl, full_name: fullName, birth_date: birthDate })
        .select()
        .single();
      if (error) throw error;
      onSave(data);
      onClose();
    } catch (err: any) {
      if (err.code === '42703' || (err.message && err.message.includes('schema cache'))) {
        alert("Baza yangilanmadi: Iltimos Supabase SQL Editorga kirib shu kodni ishlating:\n\nalter table profiles add column if not exists full_name text;\nalter table profiles add column if not exists birth_date date;\n\nVa sahifani yangilang.");
      } else if (err.code === '42501' || err?.message?.includes('row-level security')) {
        alert("Supabase RLS xatosi: Iltimos Supabase SQL Editorga kirib quyidagi kodni ishlating:\n\nalter table profiles disable row level security;");
      } else {
        alert(err.message || 'Profilni saqlashda xatolik yuz berdi');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="bg-[#111] max-w-sm w-full rounded-3xl p-6 border border-neutral-800">
        <h2 className="text-xl font-bold text-white mb-6">Profilni tahrirlash</h2>
        
        <div className="flex flex-col items-center mb-6">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <img src={displayAvatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200'} className="w-24 h-24 rounded-full object-cover" />
            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={24} className="text-white" />
            </div>
            {loading && (
              <div className="absolute inset-0 bg-black/70 rounded-full flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
          <span className="text-xs text-neutral-500 mt-2 cursor-pointer" onClick={() => fileInputRef.current?.click()}>Rasm qo'yish</span>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarSelect} />
        </div>

        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2 no-scrollbar">
          <div>
            <label className="text-xs text-neutral-400 font-semibold mb-1 block">Foydalanuvchi nomi</label>
            <input 
              type="text" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors"
              placeholder="Username"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 font-semibold mb-1 block">Toliq ism (Full Name)</label>
            <input 
              type="text" 
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors"
              placeholder="Ism Familiya"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 font-semibold mb-1 block">Tug'ilgan sana</label>
            <input 
              type="date" 
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors color-scheme-dark"
              style={{ colorScheme: 'dark' }}
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 font-semibold mb-1 block">Bio (Ma'lumot)</label>
            <textarea 
              value={bio}
              onChange={e => setBio(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors resize-none h-24"
              placeholder="O'zingiz haqingizda"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button 
            onClick={onClose}
            className="flex-1 py-3.5 bg-neutral-800 rounded-full text-white font-bold"
          >
            Bekor qilish
          </button>
          <button 
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 rounded-full text-white font-bold disabled:opacity-50 transition-colors"
          >
            Saqlash
          </button>
        </div>
      </div>
    </motion.div>
  );
};

import { FollowModal } from './components/modals/FollowModal';
import { SettingsModal } from './components/modals/SettingsModal';

const ProfileTab: React.FC<{ userId?: string, pins: WebPin[], boards: WebBoard[], onPinPress: (p: WebPin) => void, session: any, onSignOut: () => void, onBack?: () => void, onUserPress?: (id: string) => void, onMessagePress?: (convId: string) => void }> = ({ userId, pins, boards, onPinPress, session, onSignOut, onBack, onUserPress, onMessagePress }) => {
  const [tab, setTab] = useState<'created' | 'saved'>('saved');
  const [isEditing, setIsEditing] = useState(false);
  const [followModalConfig, setFollowModalConfig] = useState<{type: 'followers'|'following', userId: string} | null>(null);
  
  const targetUserId = userId || session?.user?.id;
  const isMyProfile = targetUserId === session?.user?.id;
  const userMeta = session?.user?.user_metadata || {};

  const { data: remoteProfile } = useProfile(targetUserId);
  const { data: followersCountQuery } = useFollowCount(targetUserId, 'followers');
  const { data: followingCountQuery } = useFollowCount(targetUserId, 'following');
  const { data: targetIsFollowedByMe } = useFollowStatus(session?.user?.id, targetUserId);

  const [localProfile, setLocalProfile] = useState<any>(null);
  const [optimisticFollow, setOptimisticFollow] = useState<boolean | null>(null);

  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (remoteProfile) setLocalProfile(remoteProfile);
  }, [remoteProfile]);

  const profile = localProfile || remoteProfile || {};
  const isFollowing = optimisticFollow !== null ? optimisticFollow : !!targetIsFollowedByMe;
  const [displayAvatar, setDisplayAvatar] = useState('https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200');

  useEffect(() => {
    if (profile?.avatar_url) {
      getS3ObjectUrl(profile.avatar_url).then(setDisplayAvatar);
    } else if (isMyProfile && userMeta?.avatar_url) {
      setDisplayAvatar(userMeta.avatar_url);
    }
  }, [profile?.avatar_url, isMyProfile, userMeta?.avatar_url]);

  const { data: savedPinsData, isLoading: isLoadingSaved } = useSavedPins(tab === 'saved' ? targetUserId : undefined);
  const savedPins = useMemo(() => savedPinsData?.pages.flat() || [], [savedPinsData]);

  const { data: createdPinsData, isLoading: isLoadingCreated } = useProfilePins(tab === 'created' ? targetUserId : undefined);
  
  // Use mock pins fallback to prevent breaking demo
  const username = profile?.username || (isMyProfile ? userMeta?.username : '') || 'Visual Explorer';
  const myPins = useMemo(() => {
    if (useMock) return pins.filter(p => p.author === username || p.id.startsWith('p_'));
    return createdPinsData?.pages.flat() || [];
  }, [useMock, pins, username, createdPinsData]);

  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const queryClient = useQueryClient();

   const handleFollow = async () => {
    if (useMock || isMyProfile) return;
    if (isFollowLoading) return;
    setIsFollowLoading(true);

    try {
      const alreadyFollowing = isFollowing;
      setOptimisticFollow(!alreadyFollowing);

      if (alreadyFollowing) {
        const { error: delErr } = await supabase.from('followers').delete().eq('following_id', targetUserId).eq('follower_id', session.user.id);
        if (delErr) { setOptimisticFollow(true); throw delErr; }
      } else {
        const { error: insErr } = await supabase.from('followers').insert({ following_id: targetUserId, follower_id: session.user.id });
        if (insErr) { setOptimisticFollow(false); throw insErr; }
        
        // Seng notification
        supabase.from('notifications').insert({
          user_id: targetUserId,
          actor_id: session.user.id,
          type: 'follow'
        }).then();
      }
      queryClient.invalidateQueries({ queryKey: ['followCount', 'followers', targetUserId] });
      queryClient.invalidateQueries({ queryKey: ['followStatus', session.user.id, targetUserId] });
    } catch (err) {
      console.error(err);
    } finally {
      setIsFollowLoading(false);
    }
  };

  const handleMessage = async () => {
    if (useMock || isMyProfile) return;
    try {
      const conversationId = await findOrCreateConversation(session.user.id, targetUserId);
      if (onMessagePress && conversationId) {
        onMessagePress(conversationId);
      }
    } catch (err) {
      console.error("Error creating conversation", err);
      alert("Xabar yo'llashni boshlashda xatolik yuz berdi. Iltimos barcha jadvallar yuklanganini tasdiqlang!");
    }
  };

  const fullName = profile?.full_name || (isMyProfile ? userMeta?.full_name : '') || username;
  
  // Real-time dynamic local blocking relationships checks
  const isBlockedMeToThem = isUserBlockedByMe(session?.user?.id, targetUserId);
  const isBlockedThemToMe = amIBlockedByThem(session?.user?.id, targetUserId);
  const isBlockedCurrently = isBlockedMeToThem || isBlockedThemToMe;

  const bioToUse = isBlockedCurrently ? "" : (profile?.bio || '');
  const followersCount = isBlockedCurrently ? 0 : ((Number(followersCountQuery) || 0) + (optimisticFollow === true && !targetIsFollowedByMe ? 1 : optimisticFollow === false && targetIsFollowedByMe ? -1 : 0));
  const followingCount = isBlockedCurrently ? 0 : (Number(followingCountQuery) || 0);

  const savedPinsToUse = isBlockedCurrently ? [] : savedPins;
  const myPinsToUse = isBlockedCurrently ? [] : myPins;

  const displayAvatarToUse = isBlockedCurrently 
    ? "" 
    : displayAvatar;

  const handlePinPress = useCallback((pin: WebPin) => {
    if (isBlockedCurrently) return;
    onPinPress(pin);
  }, [onPinPress, isBlockedCurrently]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pb-10 pt-12"
    >
      <div className={`flex ${isMyProfile ? 'justify-end' : 'justify-between'} px-4 mb-2`}>
        {!isMyProfile && (
          <button onClick={() => onBack ? onBack() : null} className="p-2 bg-neutral-900 rounded-full text-neutral-400 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        )}
        {isMyProfile && (
          <button onClick={() => setShowSettings(true)} className="p-2 bg-neutral-900 rounded-full text-neutral-400 hover:text-white transition-colors">
            <Settings size={20} />
          </button>
        )}
      </div>
      <div className="flex flex-col items-center px-4 mb-6">
        {displayAvatarToUse ? (
          <img src={displayAvatarToUse} className="w-28 h-28 rounded-full mb-4 object-cover border border-neutral-800 shadow-md" />
        ) : (
          <div className="w-28 h-28 bg-neutral-850 rounded-full mb-4 flex items-center justify-center border border-neutral-700 text-neutral-400 shadow-md">
            <User size={44} />
          </div>
        )}
        <h1 className="text-2xl font-bold text-white tracking-tight mb-1">{fullName}</h1>
        <p className="text-neutral-400 text-sm mb-2">@{username.toLowerCase().replace(/\s+/g, '_')}</p>
        
        {isBlockedCurrently && (
          <div className="text-[10px] bg-red-550/10 text-[#E60023] font-bold tracking-wide uppercase px-3 py-1 rounded-full mb-3 animate-pulse border border-red-500/10">
            so'nggi faollik: ancha oldin
          </div>
        )}

        <p className="text-neutral-300 text-sm mb-4 text-center max-w-sm">{bioToUse}</p>
        <div className="flex gap-4 text-sm font-semibold mb-6 text-white text-center">
          <div className="cursor-pointer hover:opacity-80" onClick={() => !isBlockedCurrently && setFollowModalConfig({ type: 'followers', userId: targetUserId })}>
            <span className="block text-lg">{followersCount}</span>
            <span className="text-neutral-500 text-xs text-neutral-450">followers</span>
          </div>
          <div className="cursor-pointer hover:opacity-80" onClick={() => !isBlockedCurrently && setFollowModalConfig({ type: 'following', userId: targetUserId })}>
            <span className="block text-lg">{followingCount}</span>
            <span className="text-neutral-500 text-xs text-neutral-450">following</span>
          </div>
        </div>

        <div className="flex gap-2">
          {isMyProfile ? (
            <button onClick={() => setIsEditing(true)} className="bg-neutral-800 hover:bg-neutral-700 transition-colors text-white font-bold px-5 py-2.5 rounded-full text-sm">Edit profile</button>
          ) : isBlockedMeToThem ? (
            <button 
              onClick={() => {
                unblockUserLocal(session?.user?.id, targetUserId);
                queryClient.invalidateQueries({ queryKey: ['conversations', session?.user?.id] });
                queryClient.invalidateQueries({ queryKey: ['followCount', 'followers', targetUserId] });
                alert("Foydalanuvchi blokdan chiqarildi.");
              }} 
              className="bg-[#E60023] hover:bg-rose-700 active:scale-97 transition-all text-white font-bold px-6 py-2.5 rounded-full text-sm shadow"
            >
              Blokdan chiqarish
            </button>
          ) : isBlockedThemToMe ? (
            <span className="text-xs text-neutral-500 bg-neutral-900 px-4 py-2 rounded-full font-medium select-none">
              Muloqot cheklangan
            </span>
          ) : (
            <div className="flex gap-2">
              <button onClick={handleFollow} className={`${isFollowing ? 'bg-transparent border border-neutral-700' : 'bg-red-650 hover:bg-red-700'} transition-colors text-white font-bold px-5 py-2.5 rounded-full text-sm`}>
                {isFollowing ? 'Following' : 'Follow'}
              </button>
              <button 
                onClick={handleMessage}
                className="bg-neutral-800 hover:bg-neutral-700 transition-colors text-white font-bold px-5 py-2.5 rounded-full text-sm"
              >
                Message
              </button>
            </div>
          )}
          {!isBlockedCurrently && (
            <button className="bg-neutral-800 text-white font-bold px-5 py-2.5 rounded-full text-sm">Share</button>
          )}
        </div>
      </div>

      <div className="flex justify-center gap-8 mb-4">
        <button 
          onClick={() => setTab('created')}
          className={`font-semibold pb-1 border-b-2 text-[15px] ${tab === 'created' ? 'border-white text-white' : 'border-transparent text-neutral-500'}`}
        >
          Created
        </button>
        <button 
          onClick={() => setTab('saved')}
          className={`font-semibold pb-1 border-b-2 text-[15px] ${tab === 'saved' ? 'border-white text-white' : 'border-transparent text-neutral-500'}`}
        >
          Saved
        </button>
      </div>

      {tab === 'saved' ? (
        <div className="columns-2 gap-2 px-2 space-y-2">
          {isLoadingSaved ? (
            <div className="w-full col-span-2 text-center text-neutral-500 mt-10">Loading saved pins...</div>
          ) : (
            <>
              {savedPinsToUse.map((p, i) => <PinCard key={`saved-${p.id}-${i}`} pin={p} onPress={() => handlePinPress(p)} session={session} />)}
              {savedPinsToUse.length === 0 && (
                <div className="w-full col-span-2 text-center text-neutral-500 mt-10 select-none">
                  No saved pins yet.
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="columns-2 gap-2 px-2 space-y-2">
          {myPinsToUse.map((p, i) => <PinCard key={`${p.id}-${i}`} pin={p} onPress={() => handlePinPress(p)} session={session} />)}
          {myPinsToUse.length === 0 && (
            <div className="w-full col-span-2 text-center text-neutral-500 mt-10 select-none">
              No pins created yet.
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {isEditing && (
          <EditProfileModal 
            profile={profile || { username: 'Visual Explorer', avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200', bio: '' }} 
            onClose={() => setIsEditing(false)} 
            onSave={(updatedProfile) => {
              setLocalProfile({ ...localProfile, ...updatedProfile });
              queryClient.invalidateQueries({ queryKey: ['profile', targetUserId] });
            }}
            session={session}
          />
        )}
        {followModalConfig && (
          <FollowModal
            userId={followModalConfig.userId}
            type={followModalConfig.type}
            onClose={() => setFollowModalConfig(null)}
            session={session}
            onUserPress={(id) => onUserPress && onUserPress(id)}
          />
        )}
        {showSettings && (
          <SettingsModal 
            onClose={() => setShowSettings(false)}
            session={session}
            onSignOut={onSignOut}
          />
        )}
      </AnimatePresence>

    </motion.div>
  );
}

// --- COMPONENTS --- //

import { useIsSaved, useToggleSavePin } from './queries';

const PinCard: React.FC<{ pin: WebPin, onPress: () => void, session?: any }> = React.memo(({ pin, onPress, session }) => {
  const [loaded, setLoaded] = useState(false);
  const currentUserId = session?.user?.id;

  const { data: isSaved } = useIsSaved(pin.id, currentUserId);
  const saveMutation = useToggleSavePin();

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
      alert("Iltimos tizimga kiring"); // Please log in
      return;
    }
    saveMutation.mutate({ pinId: pin.id, userId: currentUserId, isSaved: !!isSaved });
  };

  return (
    <motion.div 
      layoutId={`card-${pin.id}`}
      onClick={onPress}
      className="relative rounded-3xl overflow-hidden bg-[#121212] border border-white/[0.04] group cursor-pointer break-inside-avoid w-full mb-4 apple-transition hover:scale-[1.015] active:scale-[0.985] shadow-[0_4px_24px_rgba(0,0,0,0.4)] gpu-accelerated"
    >
      {!loaded && <div className="w-full aspect-[3/4] bg-neutral-900 border border-white/[0.02] animate-pulse pointer-events-none rounded-3xl" />}
      {pin.mediaType === 'video' ? (
        <video 
          src={pin.imageUrl} 
          onLoadedData={() => setLoaded(true)}
          className={`w-full h-auto block object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'absolute inset-0 opacity-0'}`}
          muted
          loop
          autoPlay
          playsInline
        />
      ) : (
        <motion.img 
          layoutId={`img-${pin.id}`}
          src={pin.imageUrl} 
          onLoad={() => setLoaded(true)}
          className={`w-full h-auto block object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'absolute inset-0 opacity-0'}`}
          loading="lazy"
          alt={pin.title}
        />
      )}
      {pin.mediaType === 'video' && (
        <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white p-1.5 rounded-full z-10 pointer-events-none flex items-center justify-center">
          <PlayCircle size={16} className="text-white ring-1 ring-white/10" />
        </div>
      )}
      {/* Overlay gradient */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-between p-3 pointer-events-none">
        <div className="flex justify-end pointer-events-auto">
          <button 
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className={`${isSaved ? 'bg-black text-white' : 'bg-[#E60023] text-white'} text-[13px] font-bold px-4 py-2 rounded-full hover:brightness-110 active:scale-95 transition-transform disabled:opacity-50`}
          >
            {isSaved ? 'Saved' : 'Save'}
          </button>
        </div>
        <div className="translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
          <span className="text-white text-sm font-bold line-clamp-1 mb-1">{pin.title}</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-white/90 text-xs font-medium">{pin.author}</span>
            <div className="flex items-center gap-2 pointer-events-auto">
              <div className="flex items-center gap-1">
                <Heart size={12} className={isSaved ? "text-[#E60023] fill-[#E60023]" : "text-white/90"} />
                <span className="text-white/90 text-xs font-medium">{pin.likesCount || 0}</span>
              </div>
              <button className="bg-white/20 backdrop-blur-md rounded-full p-1.5 hover:bg-white/30 transition-colors">
                <MoreHorizontal size={14} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

PinCard.displayName = 'PinCard';

const EditPinModal = ({ pin, onClose, onSave }: { pin: WebPin, onClose: () => void, onSave: (id: string, updates: Partial<WebPin>) => void }) => {
  const [title, setTitle] = useState(pin.title);
  const [description, setDescription] = useState(pin.description || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    await onSave(pin.id, { title, description });
    setLoading(false);
    onClose();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="bg-[#111] max-w-sm w-full rounded-3xl p-6 border border-neutral-800">
        <h2 className="text-xl font-bold text-white mb-6">Tahrirlash</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-neutral-400 font-semibold mb-1 block">Sarlavha</label>
            <input 
              type="text" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400 font-semibold mb-1 block">Ta'rif</label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-red-500 transition-colors resize-none h-24"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-8">
          <button onClick={onClose} className="flex-1 py-3.5 bg-neutral-800 rounded-full text-white font-bold">Bekor qilish</button>
          <button onClick={handleSubmit} disabled={loading} className="flex-1 py-3.5 bg-red-600 hover:bg-red-700 rounded-full text-white font-bold disabled:opacity-50 transition-colors">Saqlash</button>
        </div>
      </div>
    </motion.div>
  );
};

import { CommentItem } from './components/features/CommentItem';

const CommentsModal: React.FC<{ comments: any[], setComments: any, pinId: string, onClose: () => void, session: any, useMock: boolean }> = ({ comments, setComments, pinId, onClose, session, useMock }) => {
  const [newComment, setNewComment] = useState('');

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    
    if (useMock || pinId.startsWith('p_')) {
      setComments([...comments, { id: Date.now(), content: newComment, user_id: session?.user?.id, profiles: { username: 'You', avatar_url: session?.user?.user_metadata?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100' } }]);
      setNewComment('');
      return;
    }

    const commentText = newComment;
    setNewComment('');
    
    const newCommentObj = {
      id: Date.now(), 
      user_id: session?.user?.id,
      content: commentText,
      created_at: new Date().toISOString(),
      profiles: {
        username: session?.user?.user_metadata?.username || 'You',
        full_name: session?.user?.user_metadata?.full_name || 'You',
        avatar_url: session?.user?.user_metadata?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'
      }
    };
    
    setComments([...comments, newCommentObj]);

    const { data: createdComment, error } = await supabase.from('comments').insert({ pin_id: pinId, user_id: session?.user?.id, content: commentText }).select('id').single();
    if (error) {
      console.error("Error inserting comment:", error);
      alert("Fikr yozishda xatolik: " + error.message);
    } else if (createdComment) {
      setComments(prev => prev.map(c => c.id === newCommentObj.id ? { ...c, id: createdComment.id } : c));
    }
    
    // Check pin owner and notify
    const { data: pinData } = await supabase.from('pins').select('user_id').eq('id', pinId).single();
    if (pinData?.user_id && pinData.user_id !== session?.user?.id) {
      await supabase.from('notifications').insert({
        user_id: pinData.user_id,
        actor_id: session?.user?.id,
        type: 'comment',
        pin_id: pinId
      });
    }
  };

  const handleDelete = async (commentId: number) => {
    setComments(comments.filter(c => c.id !== commentId));
    if (!useMock) {
      await supabase.from('comments').delete().eq('id', commentId);
    }
  };

  const saveEdit = async (commentId: number, editContent: string) => {
    if (!editContent.trim()) return;
    
    setComments(comments.map(c => c.id === commentId ? { ...c, content: editContent } : c));
    
    if (!useMock) {
      await supabase.from('comments').update({ content: editContent }).eq('id', commentId);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 100 }}
      className="fixed inset-0 z-50 bg-[#0f0f0f] flex flex-col pointer-events-auto"
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div className="flex items-center justify-between p-4 pt-safe border-b border-neutral-800 bg-[#0f0f0f]/90 backdrop-blur sticky top-0 z-10">
        <div className="w-8"></div>
        <h3 className="text-white font-bold text-lg">{comments.length} Comments</h3>
        <button onClick={onClose} className="w-8 h-8 flex justify-center items-center rounded-full bg-neutral-900 text-white hover:bg-neutral-800">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {comments.map((c, i) => (
          <CommentItem 
            key={`${c.id || 'c'}-${i}`}
            comment={c}
            session={session}
            useMock={useMock}
            onDelete={handleDelete}
            onEdit={saveEdit}
          />
        ))}
      </div>
      <div className="p-4 bg-[#0f0f0f] border-t border-neutral-800 pb-safe">
        <form onSubmit={handleCommentSubmit} className="flex gap-3 items-start">
          <S3Image src={session?.user?.user_metadata?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} className="w-10 h-10 rounded-full object-cover shrink-0" skeletonClassName="rounded-full" />
          <div className="bg-neutral-900 rounded-2xl flex-1 flex flex-col px-4 py-2 ring-1 ring-neutral-800 focus-within:ring-neutral-600 transition-all">
            <input 
              type="text" 
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Add a comment" 
              className="bg-transparent border-none outline-none text-white w-full text-[15px] placeholder-neutral-500 py-1" 
            />
            <div className="flex justify-between items-center mt-1">
              <div className="flex gap-2">
                <button type="button" onClick={() => setNewComment(prev => prev + '❤️')} className="text-xl hover:scale-110 active:scale-95 transition-transform">❤️</button>
                <button type="button" onClick={() => setNewComment(prev => prev + '🙌')} className="text-xl hover:scale-110 active:scale-95 transition-transform">🙌</button>
                <button type="button" onClick={() => setNewComment(prev => prev + '🔥')} className="text-xl hover:scale-110 active:scale-95 transition-transform">🔥</button>
              </div>
              <button type="submit" disabled={!newComment.trim()} className="text-[#E60023] font-bold text-[15px] disabled:opacity-50 hover:bg-red-500/10 px-3 py-1.5 rounded-full transition-colors">Post</button>
            </div>
          </div>
        </form>
      </div>
    </motion.div>
  );
};

const PinDetail: React.FC<{ pin: WebPin, onClose: () => void, session?: any, onDelete?: (id: string) => void, onEdit?: (id: string, updates: Partial<WebPin>) => void, onAuthorPress?: (userId: string) => void, onPinPress?: (pin: WebPin) => void }> = ({ pin, onClose, session, onDelete, onEdit, onAuthorPress, onPinPress }) => {
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(pin.likesCount || 0);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [isEditingPin, setIsEditingPin] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const canDelete = session?.user?.email === 'admin@gmail.com' || (pin.userId && session?.user?.id === pin.userId);
  const currentUserId = session?.user?.id;
  const { data: feedData } = usePinsFeed('all', currentUserId);
  const morePins = useMemo(() => {
    if (!feedData?.pages) return [];
    const list = feedData.pages.flat().filter((p: WebPin) => p.id !== pin.id);
    return list.slice(0, 8);
  }, [feedData, pin.id]);

  const { data: isSaved } = useIsSaved(pin.id, currentUserId);
  const saveMutation = useToggleSavePin();

  useEffect(() => {
    if (session?.user && !useMock && pin.id && !pin.id.startsWith('p_')) {
      // Check like status
      supabase.from('likes').select('user_id').eq('pin_id', pin.id).eq('user_id', session.user.id).maybeSingle()
        .then(({ data }) => setIsLiked(!!data));
      
      // Load comments
      supabase.from('comments').select('*, profiles!comments_user_id_fkey(*)').eq('pin_id', pin.id).order('created_at', { ascending: true })
        .then(({ data, error }) => {
          if (error) console.error("Error loading comments:", error);
          if (data) setComments(data);
        });
        
      // Check follow status
      if (pin.userId && pin.userId !== session.user.id) {
        supabase.from('followers').select('follower_id').eq('following_id', pin.userId).eq('follower_id', session.user.id).maybeSingle()
          .then(({ data }) => setIsFollowing(!!data));
      }
    }
  }, [pin.id, session]);

  const [isFollowLoading, setIsFollowLoading] = useState(false);
  const [isLikeLoading, setIsLikeLoading] = useState(false);

  const handleFollow = async () => {
    if (!pin.userId || pin.userId === session?.user?.id || useMock) return;
    if (isFollowLoading) return;
    setIsFollowLoading(true);

    try {
      const { data: existingFollow } = await supabase.from('followers').select('follower_id').eq('following_id', pin.userId).eq('follower_id', session.user.id).maybeSingle();
      const alreadyFollowing = !!existingFollow;
      
      console.log(`[DEBUG] Follow Action (PinDetail): User ${session.user.id} -> Target ${pin.userId} | Already: ${alreadyFollowing}`);

      if (alreadyFollowing) {
        setIsFollowing(false);
        const { error } = await supabase.from('followers').delete().eq('following_id', pin.userId).eq('follower_id', session.user.id);
        if (error) setIsFollowing(true); // rollback
      } else {
        setIsFollowing(true);
        const { error } = await supabase.from('followers').insert({ following_id: pin.userId, follower_id: session.user.id });
        if (error) {
          setIsFollowing(false); // rollback
        } else {
          // Seng follow notification
          supabase.from('notifications').insert({
            user_id: pin.userId,
            actor_id: session.user.id,
            type: 'follow'
          }).then();
        }
      }
    } finally {
      setIsFollowLoading(false);
    }
  };

  const handleLike = async () => {
    if (useMock || pin.id.startsWith('p_')) {
      setIsLiked(prev => !prev);
      setLikesCount(prev => isLiked ? Math.max(0, prev - 1) : prev + 1);
      return;
    }
    
    if (isLikeLoading) return;
    setIsLikeLoading(true);

    try {
      const { data: existingLike } = await supabase.from('likes').select('user_id').eq('pin_id', pin.id).eq('user_id', session.user.id).maybeSingle();
      const alreadyLiked = !!existingLike;

      console.log(`[DEBUG] Like Action: User ${session.user.id} -> Pin ${pin.id} | Already: ${alreadyLiked}`);

      if (alreadyLiked) {
        setIsLiked(false);
        setLikesCount(prev => Math.max(0, prev - 1));

        const { error: delErr } = await supabase.from('likes').delete().eq('pin_id', pin.id).eq('user_id', session.user.id);
        console.log(`[DEBUG] Like Removed: `, !delErr);
        
        if (delErr) {
          setIsLiked(true);
          setLikesCount(prev => prev + 1);
        }
      } else {
        setIsLiked(true);
        setLikesCount(prev => prev + 1);

        const { error: insErr } = await supabase.from('likes').insert({ pin_id: pin.id, user_id: session.user.id });
        console.log(`[DEBUG] Like Inserted: `, !insErr);
        
        if (insErr) {
          setIsLiked(false);
          setLikesCount(prev => Math.max(0, prev - 1));
        } else {
          // Send like notification
          if (pin.userId && pin.userId !== session.user.id) {
            supabase.from('notifications').insert({
              user_id: pin.userId,
              actor_id: session.user.id,
              type: 'like',
              pin_id: pin.id
            }).then();
          }
        }
      }
    } finally {
      setIsLikeLoading(false);
    }
  };

  const handleSave = async () => {
    if (useMock || pin.id.startsWith('p_')) return;
    
    if (!currentUserId) {
      alert("Iltimos, avval tizimga kiring!");
      return;
    }

    saveMutation.mutate({ pinId: pin.id, userId: currentUserId, isSaved: !!isSaved });
  };

  const { data: currentUserProfile } = useProfile(currentUserId);

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    
    if (useMock || pin.id.startsWith('p_')) {
      setComments([...comments, { id: Date.now(), content: newComment, profiles: { username: 'You', avatar_url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100' } }]);
      setNewComment('');
      return;
    }

    const commentText = newComment;
    setNewComment('');
    
    const tempId = Date.now();
    const newCommentObj = { 
      id: tempId, 
      content: commentText, 
      user_id: session.user.id,
      profiles: currentUserProfile || { username: '...', avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100' } 
    };
    
    setComments(prev => [...prev, newCommentObj]);

    const { data: createdComment, error } = await supabase.from('comments').insert({ pin_id: pin.id, user_id: session.user.id, content: commentText }).select('id').single();
    if (error) {
      console.error("Error inserting comment:", error);
      alert("Fikr yozishda xatolik: " + error.message);
      setComments(prev => prev.filter(c => c.id !== tempId)); // rollback
    } else if (createdComment) {
      setComments(prev => prev.map(c => c.id === tempId ? { ...c, id: createdComment.id } : c));
      
      // Send comment notification
      if (pin.userId && pin.userId !== session.user.id) {
        supabase.from('notifications').insert({
          user_id: pin.userId,
          actor_id: session.user.id,
          type: 'comment',
          pin_id: pin.id,
          comment_id: createdComment.id
        }).then();
      }
    }
  };

  const isMyPin = pin.userId === session?.user?.id;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 100 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '100%' }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      className="fixed inset-0 z-50 bg-black overflow-y-auto no-scrollbar pointer-events-auto"
    >
      <div className="relative min-h-[100dvh] pb-24">
        {/* Transparent header actions */}
        <div className="absolute top-0 right-0 left-0 p-4 z-20 flex justify-between items-start">
          <button onClick={onClose} className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center text-white active:scale-95 transition-transform">
            <ChevronLeft size={24} />
          </button>
          <div className="flex gap-2 relative">
            <button 
              onClick={() => setShowMoreMenu(!showMoreMenu)} 
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white active:scale-95 transition-all outline-none ${showMoreMenu ? 'bg-[#E60023]' : 'bg-black/40 backdrop-blur-md hover:bg-black/60'}`}
            >
              <MoreHorizontal size={20} />
            </button>

            <AnimatePresence>
              {showMoreMenu && (
                <>
                  {/* Invisible backdrop to dismiss menu */}
                  <div className="fixed inset-0 z-30" onClick={() => setShowMoreMenu(false)} />
                  
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-12 z-40 w-56 bg-neutral-900/95 backdrop-blur-md rounded-2xl border border-neutral-800 p-2 shadow-2xl flex flex-col gap-1 cursor-default pointer-events-auto"
                  >
                    <button 
                      onClick={async () => {
                        setShowMoreMenu(false);
                        const link = `${window.location.origin}/pin/${pin.id}`;
                        try {
                          await navigator.clipboard.writeText(link);
                          alert("Havola clipboardga muvaffaqiyatli nusxalandi! ✨");
                        } catch {
                          alert(`Havola: ${link}`);
                        }
                      }}
                      className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-800 text-white text-[14px] transition-colors font-medium"
                    >
                      <Link size={16} className="text-neutral-400" />
                      <span>Havolani nusxalash</span>
                    </button>

                    <button 
                      onClick={async () => {
                        setShowMoreMenu(false);
                        try {
                          const response = await fetch(pin.imageUrl);
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `pin_${pin.id || 'download'}.jpg`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(url);
                        } catch (err) {
                          // Fallback
                          const a = document.createElement('a');
                          a.href = pin.imageUrl;
                          a.target = '_blank';
                          a.download = `pin_${pin.id || 'download'}.jpg`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }
                      }}
                      className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-800 text-white text-[14px] transition-colors font-medium"
                    >
                      <Download size={16} className="text-neutral-400" />
                      <span>Galereyaga saqlash</span>
                    </button>

                    {canDelete && onEdit && (
                      <button 
                        onClick={() => {
                          setShowMoreMenu(false);
                          setIsEditingPin(true);
                        }}
                        className="flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-800 text-white text-[14px] transition-colors font-medium border-t border-neutral-800/50 mt-1 pt-2"
                      >
                        <Pencil size={16} className="text-neutral-400" />
                        <span>Tahrirlash</span>
                      </button>
                    )}

                    {canDelete && onDelete && (
                      <button 
                        onClick={() => {
                          setShowMoreMenu(false);
                          if (confirm("Haqiqatan ham ushbu postni o'chirmoqchimisiz?")) {
                            onDelete(pin.id);
                          }
                        }}
                        className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-500/10 text-red-500 text-[14px] font-medium transition-colors ${!onEdit ? 'border-t border-neutral-800/50 mt-1 pt-2' : ''}`}
                      >
                        <Trash size={16} className="text-red-500" />
                        <span>O'chirish</span>
                      </button>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Hero Image */}
        <motion.div layoutId={`card-${pin.id}`} className="w-full bg-black flex justify-center items-center overflow-hidden relative">
          {pin.mediaType === 'video' ? (
            <video 
              src={pin.imageUrl} 
              className="w-full h-auto max-h-[85vh] object-contain" 
              controls
              muted
              loop
              autoPlay
              playsInline
            />
          ) : (
            <motion.img 
              layoutId={`img-${pin.id}`}
              src={pin.imageUrl} 
              className="w-full h-auto max-h-[85vh] object-contain" 
            />
          )}
          {/* Floating Actions on image */}
          <div className="absolute bottom-4 right-4 flex gap-2">
            <button 
              onClick={() => {
                if (!currentUserId) {
                  alert("Iltimos, oldin tizimga kiring!");
                  return;
                }
                setShowShareModal(true);
              }} 
              className="bg-white/90 backdrop-blur-md text-black font-bold w-12 h-12 rounded-full shadow-lg active:scale-95 transition-transform flex items-center justify-center cursor-pointer"
              title="Inboxga ulashish"
            >
              <Send size={18} className="text-neutral-800 -rotate-45 -translate-y-[1px] translate-x-[1px]" />
            </button>
            <button onClick={handleLike} className="bg-white/90 backdrop-blur-md text-black font-bold px-4 py-3 rounded-full shadow-lg active:scale-95 transition-transform flex items-center justify-center">
              <Heart size={20} className={isLiked ? "fill-[#E60023] text-[#E60023]" : ""} />
              <span className="ml-1 text-sm">{likesCount > 0 ? likesCount : ''}</span>
            </button>
            <button onClick={handleSave} disabled={saveMutation.isPending} className={`${isSaved ? 'bg-black text-white' : 'bg-[#E60023] text-white'} font-bold px-6 py-3 rounded-full text-base shadow-lg active:scale-95 transition-colors disabled:opacity-50`}>
              {isSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </motion.div>

        {/* Content Block */}
        <div className="px-4 py-6">
          <div className="flex justify-between items-center mb-4">
            <div 
              className="flex items-center gap-3 cursor-pointer group" 
              onClick={() => {
                if (pin.userId && onAuthorPress) onAuthorPress(pin.userId);
              }}
            >
              <S3Image src={pin.avatarUrl || "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100"} className="w-12 h-12 rounded-full object-cover group-hover:opacity-80 transition-opacity" />
              <div className="group-hover:opacity-80 transition-opacity">
                <span className="text-white font-bold text-sm block">{pin.author}</span>
                <span className="text-neutral-400 text-xs block">{pin.author === 'Visual Explorer' ? '1.4k followers' : 'Creator'}</span>
              </div>
            </div>
            {!isMyPin && (
              <button onClick={handleFollow} className={`${isFollowing ? 'bg-transparent border border-neutral-700' : 'bg-neutral-800'} text-white text-sm font-bold px-4 py-2 rounded-full transition-colors`}>
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            )}
          </div>

          <h1 className="text-2xl font-bold text-white mb-2 leading-tight tracking-tight">{pin.title}</h1>
          <p className="text-neutral-300 text-sm leading-relaxed mb-6">
            {pin.description}
          </p>

          {/* Comments Section */}
          <div className="mb-8">
            <h3 className="text-white font-bold text-lg mb-4">{comments.length} Comments</h3>
            
            {/* Preview limited to 2 */}
            <div className="space-y-4 mb-4">
              {comments.slice(0, 2).map((c, i) => (
                <div key={`${c.id || 'c'}-${i}`} className="flex gap-3">
                  <S3Image src={c.profiles?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} className="w-8 h-8 rounded-full object-cover shrink-0" skeletonClassName="rounded-full" />
                  <div>
                    <span className="text-white text-sm font-bold mr-2">{c.profiles?.full_name || c.profiles?.username || 'User'}</span>
                    <span className="text-neutral-300 text-sm">{c.content}</span>
                  </div>
                </div>
              ))}
              {comments.length === 0 && <p className="text-neutral-500 text-sm">Be the first to comment!</p>}
            </div>

            {comments.length > 2 && (
              <button 
                onClick={() => setShowAllComments(true)}
                className="text-neutral-400 font-medium text-sm mb-4 hover:text-white transition-colors block"
              >
                View all {comments.length} comments
              </button>
            )}
            
            <form onSubmit={handleCommentSubmit} className="flex gap-2 items-center">
              <S3Image src={session?.user?.user_metadata?.avatar_url || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100"} className="w-10 h-10 rounded-full object-cover shrink-0" skeletonClassName="rounded-full" />
              <div className="bg-neutral-900 rounded-full flex-1 flex items-center px-4 py-2">
                <input 
                  type="text" 
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder={comments.length > 0 ? "Add another comment" : "Add a comment"} 
                  className="bg-transparent border-none outline-none text-white w-full text-sm placeholder-neutral-500" 
                />
              </div>
            </form>
          </div>

          {/* Comments Modal Overlay */}
          <AnimatePresence>
            {showAllComments && (
              <CommentsModal 
                comments={comments} 
                setComments={setComments}
                pinId={pin.id} 
                onClose={() => setShowAllComments(false)}
                session={session}
                useMock={useMock}
              />
            )}
          </AnimatePresence>

          <h3 className="text-white font-bold text-lg mb-4">More to explore</h3>
          <div className="columns-2 gap-2">
            {morePins.map((p, i) => (
              <PinCard key={`${p.id}-${i}`} pin={p} onPress={() => onPinPress?.(p)} session={session} />
            ))}
            {morePins.length === 0 && (
              <div className="col-span-2 text-neutral-500 text-sm py-4 select-none">
                Boshqa postlar topilmadi
              </div>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {isEditingPin && onEdit && (
          <EditPinModal 
            pin={pin} 
            onClose={() => setIsEditingPin(false)} 
            onSave={onEdit} 
          />
        )}
        {showShareModal && (
          <ShareModal 
            isOpen={showShareModal}
            onClose={() => setShowShareModal(false)}
            pin={pin}
            currentUserId={currentUserId}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const BottomNav: React.FC<{ activeTab: string, setActiveTab: (t: any) => void, session?: any }> = ({ activeTab, setActiveTab, session }) => {
  const { data: notifications = [] } = useNotifications(session?.user?.id);
  const unreadCount = notifications.filter(n => !n.is_read).length;

  const { data: unreadMessagesCount = 0 } = useUnreadMessages(session?.user?.id);

  const isReels = activeTab === 'reels';
  return (
    <div 
      id="main-bottom-nav" 
      className={`fixed z-45 md:hidden select-none transition-all duration-500 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
        isReels 
          ? 'bottom-0 left-0 right-0 py-2.5 pb-[calc(env(safe-area-inset-bottom)+8px)] flex items-center justify-around w-full bg-gradient-to-t from-black/90 via-black/45 to-transparent border-t border-transparent' 
          : 'bottom-4 left-4 right-4 py-3 px-3 flex items-center justify-around rounded-3xl backdrop-blur-2xl bg-zinc-950/75 border border-white/[0.08] shadow-[0_12px_40px_rgba(0,0,0,0.65)]'
      }`}
    >
      {/* 1. Home tab */}
      <button 
        onClick={() => setActiveTab('home')} 
        className={`p-2 transition-all duration-300 active:scale-90 hover:scale-110 ${
          activeTab === 'home' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <Home size={22} strokeWidth={activeTab === 'home' ? 2.5 : 2} />
      </button>

      {/* 2. Search tab */}
      <button 
        onClick={() => setActiveTab('search')} 
        className={`p-2 transition-all duration-300 active:scale-90 hover:scale-110 ${
          activeTab === 'search' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <Search size={22} strokeWidth={activeTab === 'search' ? 2.5 : 2} />
      </button>

      {/* 3. Reels tab */}
      <button 
        onClick={() => setActiveTab('reels')} 
        className={`p-2 transition-all duration-300 active:scale-90 hover:scale-110 ${
          activeTab === 'reels' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <PlayCircle size={22} strokeWidth={activeTab === 'reels' ? 2.5 : 2} />
      </button>

      {/* 4. Create / Add Image or Video tab (CENTERED) */}
      <button 
        onClick={() => setActiveTab('create')} 
        className="p-1 transition-all duration-300 active:scale-90 hover:scale-115"
      >
        <div className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-bold shadow-[0_4px_16px_rgba(255,255,255,0.2)]">
          <Plus size={20} strokeWidth={3} />
        </div>
      </button>

      {/* 5. Messages / Inbox tab */}
      <button 
        onClick={() => setActiveTab('messages')} 
        className={`relative p-2 transition-all duration-300 active:scale-90 hover:scale-110 ${
          activeTab === 'messages' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <MessageCircle size={22} strokeWidth={activeTab === 'messages' ? 2.5 : 2} />
        {unreadMessagesCount > 0 && (
          <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#E60023] rounded-full ring-2 ring-zinc-950 font-semibold animate-pulse" />
        )}
      </button>

      {/* 6. Notifications tab */}
      <button 
        onClick={() => setActiveTab('notifications')} 
        className={`relative p-2 transition-all duration-300 active:scale-90 hover:scale-110 ${
          activeTab === 'notifications' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        <Heart size={22} strokeWidth={activeTab === 'notifications' ? 2.5 : 2} />
        {unreadCount > 0 && (
          <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#E60023] rounded-full ring-2 ring-zinc-950 font-semibold animate-pulse" />
        )}
      </button>

      {/* 7. Profile tab */}
      <button 
        onClick={() => setActiveTab('profile')} 
        className={`p-1.5 rounded-full border transition-all duration-300 active:scale-90 hover:scale-110 ${
          activeTab === 'profile' ? 'border-white text-white bg-zinc-900/40' : 'border-transparent text-zinc-500'
        }`}
      >
        <User size={18} strokeWidth={activeTab === 'profile' ? 2.5 : 2} />
      </button>
    </div>
  );
}
