import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, useMock } from './lib/supabase';
import { getS3ObjectUrl } from './lib/s3';
import { WebPin } from './types';
import { INITIAL_WEB_PINS } from './types';

// Let's implement cursor-based pagination for pins
const PINS_PER_PAGE = 20;

function getRandomHeight() {
  return Math.floor(Math.random() * 150) + 200; // Between 200 and 350
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (useMock) return null;
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId as string).single();
      if (error && error.code !== 'PGRST116') throw error; // ignore no rows
      return data;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useFollowStatus(followerId: string | undefined, followingId: string | undefined) {
  return useQuery({
    queryKey: ['followStatus', followerId, followingId],
    enabled: !!followerId && !!followingId,
    queryFn: async () => {
      if (useMock) return false;
      const { data, error } = await supabase
        .from('followers')
        .select('follower_id')
        .eq('following_id', followingId as string)
        .eq('follower_id', followerId as string)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: ['users', 'search', query],
    enabled: query.length > 1,
    queryFn: async () => {
      if (useMock) return [];
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .ilike('username', `%${query}%`)
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    staleTime: 1000 * 60,
  });
}

export function useFollowCount(userId: string | undefined, type: 'followers' | 'following') {
  return useQuery({
    queryKey: ['followCount', type, userId],
    enabled: !!userId,
    queryFn: async () => {
      if (useMock) return 0;
      const col = type === 'followers' ? 'following_id' : 'follower_id';
      const { count, error } = await supabase
        .from('followers')
        .select('*', { count: 'exact', head: true })
        .eq(col, userId as string);
      if (error) throw error;
      return count || 0;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useProfilePins(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['pins', 'profile', userId],
    enabled: !!userId,
    queryFn: async ({ pageParam = 0 }) => {
      if (useMock) return [];

      const from = pageParam * PINS_PER_PAGE;
      const to = from + PINS_PER_PAGE - 1;

      const { data, error } = await supabase
        .from('pins')
        .select('*, profiles!pins_user_id_fkey(*), categories(name), pin_media(*)')
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      return Promise.all(data.map(async (p: any) => {
        const media = p.pin_media?.[0] || {};
        const rawImg = media.media_url || media.thumbnail_url || '';
        return {
          id: p.id,
          title: p.title,
          description: p.description || '',
          imageUrl: rawImg ? await getS3ObjectUrl(rawImg) : '',
          category: p.categories?.name || 'Explore',
          author: p.profiles?.full_name || p.profiles?.username || 'Unknown',
          avatarUrl: p.profiles?.avatar_url ? await getS3ObjectUrl(p.profiles.avatar_url) : "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100",
          likesCount: p.likes_count || 0,
          commentsCount: p.comments_count || 0,
          width: media.width || 0,
          height: media.height || getRandomHeight(),
          userId: p.user_id,
          mediaType: media.media_type || 'image',
        } as WebPin;
      }));
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PINS_PER_PAGE) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    staleTime: 1000 * 60 * 5,
  });
}

export function useComments(pinId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['comments', pinId],
    enabled: !!pinId,
    queryFn: async ({ pageParam = 0 }) => {
      if (useMock || pinId?.startsWith('p_')) return [];
      const from = pageParam * 30;
      const to = from + 30 - 1;
      
      const { data, error } = await supabase
        .from('comments')
        .select('*, profiles!comments_user_id_fkey(*)')
        .eq('pin_id', pinId as string)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw error;
      return data;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 30) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    staleTime: 1000 * 60 * 5,
  });
}

export function useSavedPins(userId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['pins', 'saved', userId],
    enabled: !!userId,
    queryFn: async ({ pageParam = 0 }) => {
      if (useMock) return [];

      const from = pageParam * PINS_PER_PAGE;
      const to = from + PINS_PER_PAGE - 1;

      const { data, error } = await supabase
        .from('saved_pins')
        .select('pin_id, pins(*, profiles!pins_user_id_fkey(*), categories(name), pin_media(*))')
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      return Promise.all(data.map(async (d: any) => {
        const p = d.pins || {};
        const media = p.pin_media?.[0] || {};
        const rawImg = media.media_url || media.thumbnail_url || '';
        return {
          id: p.id,
          title: p.title,
          description: p.description || '',
          imageUrl: rawImg ? await getS3ObjectUrl(rawImg) : '',
          category: p.categories?.name || 'Explore',
          author: p.profiles?.full_name || p.profiles?.username || 'Unknown',
          avatarUrl: p.profiles?.avatar_url ? await getS3ObjectUrl(p.profiles.avatar_url) : "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100",
          likesCount: p.likes_count || 0,
          commentsCount: p.comments_count || 0,
          width: media.width || 0,
          height: media.height || getRandomHeight(),
          userId: p.user_id,
          mediaType: media.media_type || 'image',
        } as WebPin;
      }));
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PINS_PER_PAGE) return undefined;
      return allPages.length;
    },
    initialPageParam: 0,
    staleTime: 1000 * 60 * 5,
  });
}

export function usePinsFeed(feedType: 'all' | 'following', userId?: string) {
  return useInfiniteQuery({
    queryKey: ['pins', 'feed', feedType, userId],
    enabled: feedType === 'all' || !!userId,
    queryFn: async ({ pageParam = 0 }) => {
      if (useMock) {
        if (pageParam === 0) return INITIAL_WEB_PINS.map(pin => ({ ...pin, height: pin.height || getRandomHeight() }));
        return [];
      }

      const from = pageParam * PINS_PER_PAGE;
      const to = from + PINS_PER_PAGE - 1;

      let query = supabase
        .from('pins')
        .select('*, profiles!pins_user_id_fkey(*), categories(name), pin_media(*)', { count: 'exact' });

      if (feedType === 'following' && userId) {
        // Fetch following IDs
        const { data: following } = await supabase
          .from('followers')
          .select('following_id')
          .eq('follower_id', userId);
        
        const followingIds = following?.map(f => f.following_id) || [];
        if (followingIds.length > 0) {
          query = query.in('user_id', followingIds);
        } else {
          return []; // If not following anyone, return empty array
        }
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const dbPins: WebPin[] = await Promise.all(data.map(async (p: any) => {
        const media = p.pin_media?.[0] || {};
        const rawImg = media.media_url || media.thumbnail_url || '';
        return {
          id: p.id,
          title: p.title,
          description: p.description || '',
          imageUrl: rawImg ? await getS3ObjectUrl(rawImg) : '',
          category: p.categories?.name || 'Explore',
          author: p.profiles?.full_name || p.profiles?.username || 'Unknown',
          avatarUrl: p.profiles?.avatar_url ? await getS3ObjectUrl(p.profiles.avatar_url) : "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100",
          likesCount: p.likes_count || 0,
          commentsCount: p.comments_count || 0,
          width: media.width || 0,
          height: media.height || getRandomHeight(),
          userId: p.user_id,
          mediaType: media.media_type || 'image',
        };
      }));

      return dbPins;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < PINS_PER_PAGE) return undefined;
      return allPages.length; // Next page index
    },
    initialPageParam: 0,
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });
}

export function useSettings(userId: string | undefined) {
  return useQuery({
    queryKey: ['settings', userId],
    enabled: !!userId && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId as string)
        .maybeSingle();
      
      if (!data) {
        // Return default if not exists
        return { is_private: false, dark_mode: true, notifications_enabled: true, language: 'en' };
      }
      return data;
    },
    staleTime: Infinity,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, updates }: { userId: string, updates: any }) => {
      if (useMock) return;
      const { data: existing } = await supabase.from('user_settings').select('user_id').eq('user_id', userId).maybeSingle();
      if (existing) {
        const { error } = await supabase.from('user_settings').update(updates).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_settings').insert({ user_id: userId, ...updates });
        if (error) throw error;
      }
    },
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ['settings', userId] });
    }
  });
}

export function useIsSaved(pinId: string, userId: string | undefined) {
  return useQuery({
    queryKey: ['saved_pin', pinId, userId],
    enabled: !!userId && !!pinId && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_pins')
        .select('pin_id')
        .eq('pin_id', pinId)
        .eq('user_id', userId as string)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useToggleSavePin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pinId, userId, isSaved }: { pinId: string, userId: string, isSaved: boolean }) => {
      if (useMock) return;
      if (isSaved) {
        const { error } = await supabase
          .from('saved_pins')
          .delete()
          .match({ pin_id: pinId, user_id: userId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('saved_pins')
          .insert({ pin_id: pinId, user_id: userId });
        if (error) throw error;
      }
    },
    onMutate: async ({ pinId, userId, isSaved }) => {
      await queryClient.cancelQueries({ queryKey: ['saved_pin', pinId, userId] });
      const previous = queryClient.getQueryData(['saved_pin', pinId, userId]);
      queryClient.setQueryData(['saved_pin', pinId, userId], !isSaved);
      return { previous };
    },
    onError: (err, { pinId, userId }, context) => {
      queryClient.setQueryData(['saved_pin', pinId, userId], context?.previous);
    },
    onSettled: (data, error, { pinId, userId }) => {
      queryClient.invalidateQueries({ queryKey: ['saved_pin', pinId, userId] });
      queryClient.invalidateQueries({ queryKey: ['pins', 'saved'] }); // Invalidate saved pins feed
    }
  });
}
