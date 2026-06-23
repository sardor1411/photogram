import React, { useState, useRef } from 'react';
import { supabase, useMock } from '../lib/supabase';
import { Mail, Lock, User, Loader2, Camera } from 'lucide-react';
import { uploadToS3 } from '../lib/s3';

export default function Auth({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onload = (e) => setAvatarPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (useMock) {
      setError('Please configure Supabase EXPO_PUBLIC credentials in .env');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuthSuccess();
      } else if (mode === 'signup') {
        if (!username || username.trim().length < 3) {
          setError('Username kamida 3 ta belgidan iborat bo\'lishi shart.');
          setLoading(false);
          return;
        }

        if (password.length < 6) {
          setError('Parol kamida 6 ta belgidan iborat bo\'lishi shart.');
          setLoading(false);
          return;
        }

        // Avval username band emasligini tekshiramiz
        if (username) {
          const { data: existingUser } = await supabase.from('profiles').select('username').eq('username', username).maybeSingle();
          if (existingUser) {
            setError('Keçirasiz, ushbu username avval ro\'yxatdan o\'tgan. Iltimos boshqa username tanlang.');
            setLoading(false);
            return;
          }
        }

        let avatar_url = '';
        if (avatarFile) {
          try {
            const fileExt = avatarFile.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
            const filePath = `documents/${fileName}`;
            avatar_url = await uploadToS3(avatarFile, filePath);
          } catch (uploadErr) {
            console.error("Avatar upload failed", uploadErr);
          }
        }

        const { data, error } = await supabase.auth.signUp({ 
          email, 
          password,
          options: {
            data: { username, user_name: username, full_name: fullName, birth_date: birthDate, avatar_url },
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        });
        if (error) throw error;
        
        // Auto sign-in if email confirmation is disabled
        if (data.session) {
          onAuthSuccess();
        } else {
          setMessage('Registration successful! You may now sign in.');
          setMode('login');
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`
        });
        if (error) throw error;
        setMessage('Password reset instructions sent to your email.');
      }
    } catch (err: any) {
      console.error("Auth error details:", err);
      
      let allProps: any = {};
      try {
        if (err && typeof err === 'object') {
          Object.getOwnPropertyNames(err).forEach(key => {
            allProps[key] = err[key];
          });
        } else {
          allProps = err;
        }
      } catch (e) {}

      console.error("Auth error all properties:", allProps);

      let errorMessage = allProps.message || allProps.msg || (typeof err === 'string' ? err : JSON.stringify(allProps));
      
      if (errorMessage === '{}' || !errorMessage || errorMessage === '""') {
        errorMessage = 'Siz kiritgan ma\'lumotlarda xatolik bor (masalan email noto\'g\'ri) yoki username band. Boshqa username/email bilan qayta urinib ko\'ring. Parol kamida 6 ta belgi bo\'lishi shart.';
      }

      if (errorMessage.includes('Database error saving new user')) {
        errorMessage = 'Ro\'yxatdan o\'tishda xatolik. Bu ko\'pincha "username" oldin ro\'yxatdan o\'tganligi sababli yuzaga keladi. Iltimos boshqa "username" kiritib ko\'ring.';
      }

      if (errorMessage.includes('User already registered') || errorMessage.includes('already exists')) {
        errorMessage = 'Bu email manzil band. Iltimos, boshqa email kiriting yoki hisobingizga kiring.';
      }

      if (errorMessage.includes('Invalid login credentials')) {
        if (email === 'admin@gmail.com' && password === 'admin123') {
           // Admin auto-signup attempt
           const { data, error: signUpErr } = await supabase.auth.signUp({ email, password, options: { data: { username: 'Admin' } } });
           if (!signUpErr && data.session) {
              onAuthSuccess();
              return;
           }
        }
        setError('Noto\'g\'ri email yoki parol. Agar hisob yaratgan bo\'lsangiz, Supabase paneliga kirib Authentication -> Providers -> Email bo\'limidan "Confirm email" ni O\'CHIRIB qo\'yishingiz kerak! Aks holda tizimga kirolmaysiz!');
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google') => {
    if (useMock) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      });
      if (error) throw error;
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setError('Noto\'g\'ri email yoki parol. Eslatma: Agar endi ro\'yxatdan o\'tgan bo\'lsangiz, Supabase panelidan Authentication -> Providers -> Email bo\'limiga kirib "Confirm email" tugmasini o\'chirib qo\'yishingiz kerak, aks holda tasdiqlashsiz kirolmaysiz!');
      } else {
        setError(err.message);
      }
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#0f0f0f]">
      <div className="w-full max-w-sm bg-[#141414] border border-[#222] rounded-3xl p-8 animate-fade-in shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="h-12 w-12 bg-[#E60023] rounded-full flex items-center justify-center text-white font-black text-2xl tracking-tighter cursor-pointer">
            P
          </div>
        </div>
        
        <h2 className="text-2xl font-bold text-center text-white mb-2">
          {mode === 'login' && 'Log in to Pinterest'}
          {mode === 'signup' && 'Sign up for Pinterest'}
          {mode === 'forgot' && 'Reset Password'}
        </h2>
        <p className="text-center text-neutral-400 text-sm mb-8">
          Find new ideas to try
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 text-sm p-3 rounded-xl mb-6 text-center">
            {error}
          </div>
        )}
        
        {message && (
          <div className="bg-green-500/10 border border-green-500/20 text-green-500 text-sm p-3 rounded-xl mb-6 text-center">
            {message}
          </div>
        )}

        {useMock && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 text-xs p-3 rounded-xl mb-6 text-center">
            Warning: Missing EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env
          </div>
        )}

        {mode !== 'forgot' && (
          <div className="mb-6 space-y-3">
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              disabled={loading || useMock}
              className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-bold py-3 rounded-full flex items-center justify-center gap-2 transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-neutral-800"></div>
              <span className="flex-shrink-0 mx-4 text-neutral-500 text-xs">OR</span>
              <div className="flex-grow border-t border-neutral-800"></div>
            </div>
          </div>
        )}

        <form onSubmit={handleAuth} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div className="flex flex-col items-center mb-4">
                <div 
                  className="relative group cursor-pointer w-20 h-20 bg-[#1c1c1c] border-2 border-dashed border-neutral-700 rounded-full flex items-center justify-center overflow-hidden hover:border-[#E60023] transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} className="w-full h-full object-cover" />
                  ) : (
                    <Camera size={24} className="text-neutral-500 group-hover:text-[#E60023] transition-colors" />
                  )}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={20} className="text-white" />
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleAvatarSelect} 
                />
                <span className="text-xs text-neutral-500 mt-2">Profil rasmi (Ixtiyoriy)</span>
              </div>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" size={18} />
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full bg-[#1c1c1c] border border-neutral-800 text-white rounded-xl py-3 pl-12 pr-4 outline-none focus:border-[#E60023] transition-colors"
                />
              </div>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" size={18} />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full bg-[#1c1c1c] border border-neutral-800 text-white rounded-xl py-3 pl-12 pr-4 outline-none focus:border-[#E60023] transition-colors"
                />
              </div>
              <div className="relative">
                <input
                  type="date"
                  placeholder="Birth Date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  required
                  className="w-full bg-[#1c1c1c] border border-neutral-800 text-white rounded-xl py-3 px-4 outline-none focus:border-[#E60023] transition-colors color-scheme-dark"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            </>
          )}
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" size={18} />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-[#1c1c1c] border border-neutral-800 text-white rounded-xl py-3 pl-12 pr-4 outline-none focus:border-[#E60023] transition-colors"
            />
          </div>
          {mode !== 'forgot' && (
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" size={18} />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#1c1c1c] border border-neutral-800 text-white rounded-xl py-3 pl-12 pr-4 outline-none focus:border-[#E60023] transition-colors"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || useMock}
            className="w-full bg-[#E60023] hover:bg-[#E60023]/90 disabled:opacity-50 text-white font-bold py-3 rounded-full mt-4 flex items-center justify-center transition-all active:scale-[0.98]"
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : (mode === 'login' ? 'Log in' : mode === 'signup' ? 'Continue' : 'Send Reset Link')}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3 text-center text-sm font-semibold">
          {mode === 'login' && (
            <button onClick={() => setMode('forgot')} className="text-neutral-400 hover:text-white hover:underline transition-colors">
              Forgot password?
            </button>
          )}
          <div>
            <span className="text-neutral-500">
              {mode === 'login' ? 'Not on Pinterest yet? ' : 'Already a member? '}
            </span>
            <button 
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              type="button" 
              className="text-white hover:underline"
            >
              {mode === 'login' ? 'Sign up' : 'Log in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
