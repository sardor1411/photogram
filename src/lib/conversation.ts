import { supabase } from './supabase';

export async function findOrCreateConversation(currentUserId: string, targetUserId: string): Promise<string> {
  const [user1_id, user2_id] = currentUserId < targetUserId
    ? [currentUserId, targetUserId]
    : [targetUserId, currentUserId];

  // 1. Direct query using the user1_id & user2_id columns
  const { data: existing, error: existingErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('user1_id', user1_id)
    .eq('user2_id', user2_id)
    .maybeSingle();

  if (!existingErr && existing) {
    return existing.id;
  }

  // 2. Create new conversation of type 'direct' with user1_id and user2_id populated
  const { data: newConv, error: newConvErr } = await supabase
    .from('conversations')
    .insert({
      conversation_type: 'direct',
      created_by: currentUserId,
      user1_id,
      user2_id,
      title: 'Direct Chat'
    })
    .select()
    .single();

  if (newConvErr) throw newConvErr;
  if (!newConv) throw new Error('Suhbat yaratib boʻlmadi');

  // 3. Insert conversation participants for compatibility / extra queries
  const { error: partErr } = await supabase
    .from('conversation_participants')
    .insert([
      { conversation_id: newConv.id, user_id: currentUserId },
      { conversation_id: newConv.id, user_id: targetUserId }
    ]);

  if (partErr) {
    console.error('Error inserting participants:', partErr);
  }

  return newConv.id;
}
