import React, { useState } from 'react';
import { Pencil, Trash, MessageCircle, Heart } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { S3Image } from '../S3Image';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';

const CommentReplyItem: React.FC<{ reply: any, session: any, useMock: boolean, onDelete: (id: number) => void }> = ({ reply, session, useMock, onDelete }) => {
  const currentUserId = session?.user?.id;
  const isOwner = currentUserId === reply.user_id;

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(reply.content);
  
  const { data: likesCount = 0, refetch: refetchLikesCount } = useQuery({
    queryKey: ['reply_likes_count', reply.id],
    enabled: !useMock,
    queryFn: async () => {
      const { count } = await supabase.from('reply_likes').select('*', { count: 'exact', head: true }).eq('reply_id', reply.id);
      return count || 0;
    }
  });

  const { data: isLiked = false, refetch: refetchIsLiked } = useQuery({
    queryKey: ['reply_is_liked', reply.id, currentUserId],
    enabled: !!currentUserId && !useMock,
    queryFn: async () => {
      const { data } = await supabase.from('reply_likes').select('user_id').eq('reply_id', reply.id).eq('user_id', currentUserId).maybeSingle();
      return !!data;
    }
  });

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;
    setEditing(false);
    reply.content = editContent; // optimistic
    if (!useMock) await supabase.from('comment_replies').update({ content: editContent }).eq('id', reply.id);
  };

  const toggleLike = async () => {
    if (!currentUserId || useMock) return;
    if (isLiked) {
      await supabase.from('reply_likes').delete().eq('reply_id', reply.id).eq('user_id', currentUserId);
    } else {
      await supabase.from('reply_likes').insert({ reply_id: reply.id, user_id: currentUserId });
      if (reply.user_id && reply.user_id !== currentUserId) {
         supabase.from('notifications').insert({ user_id: reply.user_id, actor_id: currentUserId, type: 'like' }).then();
      }
    }
    refetchIsLiked();
    refetchLikesCount();
  };

  return (
    <div className="flex gap-2 group">
      <S3Image src={reply.profiles?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${reply.profiles?.id || 'r'}`} className="w-8 h-8 rounded-full object-cover shrink-0" skeletonClassName="rounded-full" />
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-white text-[13px] font-bold">{reply.profiles?.username || 'User'}</span>
          {reply.created_at && (
            <span className="text-neutral-500 text-[11px]">{formatDistanceToNow(new Date(reply.created_at), { addSuffix: true })}</span>
          )}
        </div>
        {editing ? (
          <div className="flex gap-2 mt-1">
            <input 
              type="text" 
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="bg-neutral-800 border-none outline-none text-white text-sm px-3 py-1 rounded w-full"
              autoFocus
            />
            <button onClick={handleSaveEdit} className="text-[#E60023] text-sm font-bold">Save</button>
            <button onClick={() => setEditing(false)} className="text-neutral-400 text-sm">Cancel</button>
          </div>
        ) : (
          <span className="text-neutral-200 text-[13px] mt-0.5 inline-block">{reply.content}</span>
        )}
        {!editing && (
          <div className="flex gap-3 mt-1 items-center">
            <button onClick={toggleLike} className={`text-[11px] flex items-center gap-1 ${isLiked ? 'text-red-500 font-bold' : 'text-neutral-500 font-semibold hover:text-white'}`}>
              {likesCount > 0 && <span>{likesCount} </span>}
              {isLiked ? 'Liked' : 'Like'}
            </button>
            {isOwner && (
              <>
                <button onClick={() => setEditing(true)} className="text-neutral-600 font-semibold text-[11px] hover:text-white transition-colors">Edit</button>
                <button onClick={() => onDelete(reply.id)} className="text-neutral-600 font-semibold text-[11px] hover:text-red-500 transition-colors">Delete</button>
              </>
            )}
          </div>
        )}
      </div>
      {!editing && (
         <button onClick={toggleLike} className="self-center p-2 opacity-0 group-hover:opacity-100 transition-opacity">
           <Heart size={12} className={isLiked ? 'fill-red-500 text-red-500' : 'text-neutral-500'} />
         </button>
      )}
    </div>
  );
};

export const CommentItem: React.FC<{ 
  comment: any, 
  session: any, 
  onDelete: (id: number) => void,
  onEdit: (id: number, content: string) => void,
  useMock: boolean 
}> = ({ comment, session, onDelete, onEdit, useMock }) => {
  const isOwner = session?.user?.id && comment.user_id === session.user.id;
  const currentUserId = session?.user?.id;
  
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  
  const [showReplies, setShowReplies] = useState(false);
  const [replying, setReplying] = useState(false);
  const [replyContent, setReplyContent] = useState('');

  const { data: replies = [], refetch } = useQuery({
    queryKey: ['comment_replies', comment.id],
    enabled: showReplies && !useMock,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('comment_replies')
        .select('*, profiles!comment_replies_user_id_fkey(*)')
        .eq('comment_id', comment.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  const { data: replyCount = 0 } = useQuery({
    queryKey: ['reply_count', comment.id],
    enabled: !useMock,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('comment_replies')
        .select('*', { count: 'exact', head: true })
        .eq('comment_id', comment.id);
      if (error) throw error;
      return count || 0;
    }
  });

  const { data: commentLikesCount = 0, refetch: refetchCommentLikesCount } = useQuery({
    queryKey: ['comment_likes_count', comment.id],
    enabled: !useMock,
    queryFn: async () => {
      const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', comment.id);
      return count || 0;
    }
  });

  const { data: isCommentLiked = false, refetch: refetchIsCommentLiked } = useQuery({
    queryKey: ['comment_is_liked', comment.id, currentUserId],
    enabled: !!currentUserId && !useMock,
    queryFn: async () => {
      const { data } = await supabase.from('comment_likes').select('user_id').eq('comment_id', comment.id).eq('user_id', currentUserId).maybeSingle();
      return !!data;
    }
  });

  const toggleCommentLike = async () => {
    if (!currentUserId || useMock) return;
    if (isCommentLiked) {
      await supabase.from('comment_likes').delete().eq('comment_id', comment.id).eq('user_id', currentUserId);
    } else {
      await supabase.from('comment_likes').insert({ comment_id: comment.id, user_id: currentUserId });
      if (comment.user_id && comment.user_id !== currentUserId) {
         supabase.from('notifications').insert({ user_id: comment.user_id, actor_id: currentUserId, type: 'like' }).then();
      }
    }
    refetchIsCommentLiked();
    refetchCommentLikesCount();
  };

  const handleSaveEdit = () => {
    onEdit(comment.id, editContent);
    setEditing(false);
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim() || !currentUserId || useMock) return;
    
    setReplying(false);
    const content = replyContent;
    setReplyContent('');
    
    // Add reply
    await supabase.from('comment_replies').insert({
      comment_id: comment.id,
      user_id: currentUserId,
      content: content
    });
    
    // Refetch replies
    refetch();
    
    // Notify
    if (comment.user_id && comment.user_id !== currentUserId) {
      supabase.from('notifications').insert({
        user_id: comment.user_id,
        actor_id: currentUserId,
        type: 'reply',
        comment_id: comment.id
      }).then();
    }
  };

  const deleteReply = async (replyId: number) => {
    if (useMock) return;
    await supabase.from('comment_replies').delete().eq('id', replyId);
    refetch();
  };

  return (
    <div className="flex flex-col gap-2 relative group">
      <div className="flex gap-3">
        <S3Image src={comment.profiles?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.profiles?.id || 'default'}`} className="w-10 h-10 rounded-full object-cover shrink-0" skeletonClassName="rounded-full" />
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-white text-[13px] font-bold">{comment.profiles?.full_name || comment.profiles?.username || 'User'}</span>
            {comment.created_at && (
              <span className="text-neutral-500 text-xs">{formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}</span>
            )}
          </div>
          
          {editing ? (
            <div className="flex gap-2 mt-1 relative z-10">
              <input 
                type="text" 
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="bg-neutral-800 border-none outline-none text-white text-sm px-3 py-1.5 rounded-lg w-full"
                autoFocus
              />
              <button onClick={handleSaveEdit} className="text-[#E60023] text-sm font-bold shrink-0">Save</button>
              <button onClick={() => setEditing(false)} className="text-neutral-400 hover:text-white text-sm shrink-0">Cancel</button>
            </div>
          ) : (
            <span className="text-neutral-200 text-sm mt-0.5 inline-block">{comment.content}</span>
          )}
          
          {!editing && (
            <div className="flex gap-4 mt-2">
              <button onClick={toggleCommentLike} className={`text-xs font-semibold flex items-center gap-1 transition-colors ${isCommentLiked ? 'text-red-500 font-bold' : 'text-neutral-500 hover:text-white'}`}>
                {commentLikesCount > 0 && <span>{commentLikesCount} </span>}
                {isCommentLiked ? 'Liked' : 'Like'}
              </button>
              <button onClick={() => setReplying(!replying)} className="text-neutral-500 text-xs font-semibold hover:text-white transition-colors">Reply</button>
              {isOwner && (
                <>
                  <button onClick={() => setEditing(true)} className="text-neutral-500 text-xs font-semibold hover:text-white flex items-center gap-1 transition-colors"><Pencil size={12}/> Edit</button>
                  <button onClick={() => onDelete(comment.id)} className="text-neutral-500 text-xs font-semibold hover:text-red-500 flex items-center gap-1 transition-colors"><Trash size={12}/> Delete</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {!editing && (
         <button onClick={toggleCommentLike} className="absolute right-0 top-1 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
           <Heart size={14} className={isCommentLiked ? 'fill-red-500 text-red-500' : 'text-neutral-500'} />
         </button>
      )}

      {replying && (
        <form onSubmit={submitReply} className="ml-13 mt-2 flex gap-2 items-center">
          <input 
            type="text"
            value={replyContent}
            onChange={e => setReplyContent(e.target.value)}
            placeholder={`Reply to ${comment.profiles?.username || 'user'}...`}
            className="flex-1 bg-neutral-900 border border-neutral-800 outline-none text-white text-sm px-4 py-2 rounded-full focus:border-neutral-600 transition-colors"
            autoFocus
          />
          <button type="submit" disabled={!replyContent.trim()} className="text-[#E60023] font-bold text-sm px-2 disabled:opacity-50">Post</button>
        </form>
      )}

      {replyCount > 0 && !showReplies && (
        <div className="ml-13 mt-1">
          <button onClick={() => { setShowReplies(true); refetch(); }} className="flex items-center gap-2 text-neutral-400 font-semibold text-xs hover:text-white">
            <div className="w-6 h-[1px] bg-neutral-700"></div>
            View {replyCount} repl{replyCount === 1 ? 'y' : 'ies'}
          </button>
        </div>
      )}

      {showReplies && replies.length > 0 && (
        <div className="ml-13 mt-3 flex flex-col gap-4">
          {replies.map(reply => (
            <CommentReplyItem key={reply.id} reply={reply} session={session} useMock={useMock} onDelete={deleteReply} />
          ))}
          <button onClick={() => setShowReplies(false)} className="self-start text-neutral-500 text-xs font-semibold hover:text-white mt-1">
            Hide replies
          </button>
        </div>
      )}
    </div>
  );
};
