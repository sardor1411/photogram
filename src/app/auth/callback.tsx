import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleAuthCallback() {
      try {
        // Supabase historically handled the fragment part on its own if initialize is true,
        // but since we might get 'access_token' in the hash or 'code' in the query:
        
        // Wait a slight moment for supabase to process the URL fragment automatically:
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        if (session) {
          navigate('/');
          return;
        }

        // If no session, wait for onAuthStateChange to fire
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
          if (event === 'SIGNED_IN' || newSession) {
            navigate('/');
          }
        });

        // Also check if there's a specific error in the hash manually
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const errorDescription = hashParams.get('error_description');
        if (errorDescription) {
          setError(errorDescription);
        }

        return () => subscription.unsubscribe();
      } catch (err: any) {
        setError(err.message || 'Error parsing auth token');
      }
    }

    handleAuthCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#0f0f0f] text-white">
        <h1 className="text-2xl font-bold mb-4">Authentication Error</h1>
        <p className="text-red-400 mb-6">{error}</p>
        <button
          onClick={() => navigate('/')}
          className="bg-white/10 hover:bg-white/20 text-white font-bold py-2 px-6 rounded-full transition-colors"
        >
          Go Back Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0f0f0f]">
      <Loader2 size={40} className="animate-spin text-[#E60023]" />
      <p className="text-white mt-4 font-semibold">Completing sign in...</p>
    </div>
  );
}
