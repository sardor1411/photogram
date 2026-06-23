import React, { useState, useEffect, useRef } from 'react';
import { getS3ObjectUrl } from '../lib/s3';

export const S3Image: React.FC<React.ImgHTMLAttributes<HTMLImageElement> & { skeletonClassName?: string }> = ({ src, className, skeletonClassName, ...props }) => {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  
  useEffect(() => {
    let mounted = true;
    if (src) {
      setError(false);
      
      // Attempt to immediately determine if the src is a data URL or external URL requiring no signing
      if (src.startsWith('data:') || src.startsWith('blob:')) {
         setUrl(src);
      } else {
        getS3ObjectUrl(src)
          .then(signedUrl => {
            if (mounted) setUrl(signedUrl);
          })
          .catch(() => {
            if (mounted) setError(true);
          });
      }
    } else {
      setUrl(undefined);
    }
    return () => { mounted = false; };
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${className || ''}`} style={{ display: 'inline-flex' }}>
      {(!loaded || !url) && !error && (
        <div className={`absolute inset-0 bg-neutral-800 animate-pulse ${skeletonClassName || ''}`} />
      )}
      {url && !error && (
        <img 
          ref={imgRef}
          src={url} 
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`} 
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(true);
            setError(true);
          }}
          {...props} 
        />
      )}
      {error && (
        <div className="absolute inset-0 bg-neutral-900 flex items-center justify-center">
          <span className="text-neutral-500 text-xs">Error</span>
        </div>
      )}
    </div>
  );
}
