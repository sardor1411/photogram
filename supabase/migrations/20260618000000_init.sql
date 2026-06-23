-- 20260618000000_init.sql
-- Create database schema for Pinterest Photo Sharing App with Row Level Security (RLS)

-- 1. Create profiles table (extends auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_url text,
  bio text,
  created_at timestamptz default now()
);

-- 2. Create pins table (extends profiles)
create table public.pins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  title text not null,
  description text,
  image_url text not null,   -- Direct S3 URL
  category text default 'All',
  likes_count int default 0,
  width int not null default 1200,
  height int not null default 1200,
  blurhash text,
  created_at timestamptz default now()
);

-- 3. Create boards table
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  cover_image_url text,
  created_at timestamptz default now()
);

-- 4. Create saved_pins (Pin <-> Board junction table)
create table public.saved_pins (
  pin_id uuid references public.pins(id) on delete cascade not null,
  board_id uuid references public.boards(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (pin_id, board_id)
);

-- 5. Create likes table
create table public.likes (
  user_id uuid references public.profiles(id) on delete cascade not null,
  pin_id uuid references public.pins(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (user_id, pin_id)
);

-- 6. Create comments table
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid references public.pins(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

-- 7. Create follows table
create table public.follows (
  follower_id uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (follower_id, following_id)
);

-- 8. Create notifications table
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  type text not null, -- 'like', 'comment', 'follow', 'pin'
  actor_id uuid references public.profiles(id) on delete cascade not null,
  pin_id uuid references public.pins(id) on delete cascade,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
alter table public.profiles enable row level security;
alter table public.pins enable row level security;
alter table public.boards enable row level security;
alter table public.saved_pins enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.notifications enable row level security;

-- PROFILES SECURITY POLICIES
create policy "Allow public read access to profiles" on public.profiles
  for select using (true);

create policy "Allow users to insert their own profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "Allow users to update their own profile" on public.profiles
  for update using (auth.uid() = id);

-- PINS SECURITY POLICIES
create policy "Allow public read access to pins" on public.pins
  for select using (true);

create policy "Allow authenticated users to create pins" on public.pins
  for insert with check (auth.role() = 'authenticated' and auth.uid() = user_id);

create policy "Allow owner to update pins" on public.pins
  for update using (auth.uid() = user_id);

create policy "Allow owner to delete pins" on public.pins
  for delete using (auth.uid() = user_id);

-- BOARDS SECURITY POLICIES
create policy "Allow public read access to boards" on public.boards
  for select using (true);

create policy "Allow authenticated users to create boards" on public.boards
  for insert with check (auth.role() = 'authenticated' and auth.uid() = user_id);

create policy "Allow owner to update boards" on public.boards
  for update using (auth.uid() = user_id);

create policy "Allow owner to delete boards" on public.boards
  for delete using (auth.uid() = user_id);

-- SAVED_PINS SECURITY POLICIES
create policy "Allow owner of board to select saved_pins" on public.saved_pins
  for select using (
    exists (
      select 1 from public.boards
      where boards.id = saved_pins.board_id and boards.user_id = auth.uid()
    )
  );

create policy "Allow owner of board to insert saved_pins" on public.saved_pins
  for insert with check (
    exists (
      select 1 from public.boards
      where boards.id = board_id and boards.user_id = auth.uid()
    )
  );

create policy "Allow owner of board to delete saved_pins" on public.saved_pins
  for delete using (
    exists (
      select 1 from public.boards
      where boards.id = board_id and boards.user_id = auth.uid()
    )
  );

-- LIKES SECURITY POLICIES
create policy "Allow public read access to likes" on public.likes
  for select using (true);

create policy "Allow authenticated users to join a like" on public.likes
  for insert with check (auth.role() = 'authenticated' and auth.uid() = user_id);

create policy "Allow users to unlike their own like" on public.likes
  for delete using (auth.uid() = user_id);

-- COMMENTS SECURITY POLICIES
create policy "Allow public read access to comments" on public.comments
  for select using (true);

create policy "Allow authenticated users to comment" on public.comments
  for insert with check (auth.role() = 'authenticated' and auth.uid() = user_id);

create policy "Allow owner to update comments" on public.comments
  for update using (auth.uid() = user_id);

create policy "Allow owner or pin creator to delete comments" on public.comments
  for delete using (
    auth.uid() = user_id or 
    exists (
      select 1 from public.pins 
      where pins.id = pin_id and pins.user_id = auth.uid()
    )
  );

-- FOLLOWS SECURITY POLICIES
create policy "Allow public read access to follows" on public.follows
  for select using (true);

create policy "Allow authenticated users to follow" on public.follows
  for insert with check (auth.role() = 'authenticated' and auth.uid() = follower_id);

create policy "Allow users to unfollow" on public.follows
  for delete using (auth.uid() = follower_id);

-- NOTIFICATIONS SECURITY POLICIES
create policy "Allow users to read their own notifications" on public.notifications
  for select using (auth.uid() = user_id);

create policy "Allow system/actor to insert notifications" on public.notifications
  for insert with check (auth.role() = 'authenticated' and auth.uid() = actor_id);

create policy "Allow users to update/mark read their own notifications" on public.notifications
  for update using (auth.uid() = user_id);

-- TRIGGERS & AUTO PROFILE CREATION
-- Drop function if exists
drop function if exists public.handle_new_user() cascade;

-- Define automated handler function
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, avatar_url, bio)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'avatar_url', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'),
    'Welcome to my creative space!'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to execute upon auth.users insertion
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
