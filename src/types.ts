// src/types.ts
// Shared interfaces and registries for the Pinterest dynamic Web layout.

export interface WebPin {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  author: string;
  avatarUrl: string;
  likesCount: number;
  commentsCount?: number;
  width: number;
  height: number;
  blurhash?: string;
  userId?: string;
  mediaType?: 'image' | 'video';
}

export interface WebComment {
  id: string;
  user: string;
  text: string;
  avatar: string;
}

export interface WebBoard {
  id: string;
  name: string;
  count: number;
  cover: string;
  isPrivate: boolean;
}

export const INITIAL_WEB_PINS: WebPin[] = [
  {
    id: "p1",
    title: "Minimal Living Curve",
    description: "A serene look into organic curves, soft tactile plaster walling, and linear oak accents that anchor absolute physical and visual comfort.",
    imageUrl: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=700&q=80",
    category: "Explore",
    author: "Aura Design",
    avatarUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80",
    likesCount: 243,
    width: 600,
    height: 800,
    blurhash: "L6Of9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p2",
    title: "Brutalist Concrete Loft",
    description: "Monastic concrete beams paired with extensive frameless glass panels to frame dynamic natural landscapes.",
    imageUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=700&q=80",
    category: "Architecture",
    author: "Forma Studio",
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
    likesCount: 412,
    width: 600,
    height: 900,
    blurhash: "L7Of8k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p3",
    title: "Organic Clay Vessel",
    description: "Hand-pinched volcanic clay jars fired to perfection, showcasing unique bubble details, coarse sandstone textures, and raw uneven finishes.",
    imageUrl: "https://images.unsplash.com/photo-1612196808214-b8e1d6145a8c?auto=format&fit=crop&w=700&q=80",
    category: "Minimal",
    author: "Clay & Co",
    avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80",
    likesCount: 119,
    width: 600,
    height: 600,
    blurhash: "L8Of9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p4",
    title: "Atmospheric Sand Fields",
    description: "Soft atmospheric oil textures drifting inside cosmic fields of purple sand, magenta pigments, and celestial cloud outlines.",
    imageUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=700&q=80",
    category: "Abstract",
    author: "Palette World",
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80",
    likesCount: 981,
    width: 600,
    height: 850,
    blurhash: "L9Of9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p5",
    title: "Mist Shrouded Pines",
    description: "Early morning fog rising through Douglas fir trees, capturing ambient forest sunbeams in high-density atmospheric depth.",
    imageUrl: "https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=700&q=80",
    category: "Nature",
    author: "Glade Cam",
    avatarUrl: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=150&q=80",
    likesCount: 350,
    width: 600,
    height: 750,
    blurhash: "LAOf9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p6",
    title: "Modular Terminal Deck",
    description: "Modular synthesizer layout complete with copper terminals, OLED dynamic spectrum screens, and matte high-contrast black keys.",
    imageUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=700&q=80",
    category: "Tech",
    author: "Neon Core",
    avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150&q=80",
    likesCount: 820,
    width: 600,
    height: 700,
    blurhash: "LBOf9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p7",
    title: "Linear Steel Facades",
    description: "Polished reflective steel sheets cascading in structural grids, mirroring surrounding architecture in sharp monochrome contrasts.",
    imageUrl: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=700&q=80",
    category: "Architecture",
    author: "Skyline Labs",
    avatarUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&q=80",
    likesCount: 588,
    width: 600,
    height: 1000,
    blurhash: "LCOf9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p8",
    title: "Geometric Swiss Poster",
    description: "Swiss Modernist layout pairing clean constructivist lines, grid shapes, and bright visual alignments for typographic exhibition designs.",
    imageUrl: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=700&q=80",
    category: "Illustration",
    author: "Studio Vector",
    avatarUrl: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=150&q=80",
    likesCount: 147,
    width: 600,
    height: 650,
    blurhash: "LDOf9k_D00~q_ct7%MRj004n_3xu"
  },
  {
    id: "p9",
    title: "Neon Cyberpunk Night",
    description: "A stunning capture of Tokyo's vibrant neon district in the rain, reflecting vibrant pinks and blues over the wet pavement.",
    imageUrl: "https://images.unsplash.com/photo-1515462277126-2dd0c162007a?auto=format&fit=crop&w=700&q=80",
    category: "Tech",
    author: "Night City V",
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80",
    likesCount: 890,
    width: 600,
    height: 900
  },
  {
    id: "p10",
    title: "Minimalist Kitchen",
    description: "A bright and airy minimalist kitchen interior focused on functional beauty and muted gray tones.",
    imageUrl: "https://images.unsplash.com/photo-1556910103-1c02745a872f?auto=format&fit=crop&w=700&q=80",
    category: "Architecture",
    author: "Interior Mag",
    avatarUrl: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
    likesCount: 421,
    width: 600,
    height: 700
  },
  {
    id: "p11",
    title: "Ceramic Coffee Setup",
    description: "Beautiful handmade ceramic drippers perfect for slow mornings.",
    imageUrl: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=700&q=80",
    category: "Explore",
    author: "Coffee Culture",
    avatarUrl: "https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=150&q=80",
    likesCount: 112,
    width: 600,
    height: 800
  },
  {
    id: "p12",
    title: "Analog Syntax",
    description: "Macro details of vintage analog syntesizers and classic audio equipment showcasing brushed metal and bright red knobs.",
    imageUrl: "https://images.unsplash.com/photo-1598653222000-6b7b7ff0175b?auto=format&fit=crop&w=700&q=80",
    category: "Tech",
    author: "Audiophile",
    avatarUrl: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150&q=80",
    likesCount: 63,
    width: 600,
    height: 600
  },
  {
    id: "p13",
    title: "Neon Cyber Street Lights",
    description: "Vibrant neon reflections bouncing over urban streetscapes with cyber-punk silhouettes, capturing Tokyo's night movement.",
    imageUrl: "https://assets.mixkit.co/videos/preview/mixkit-girl-in-neon-sign-nightclub-42247-large.mp4",
    category: "Tech",
    author: "cyber_vibes",
    avatarUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150",
    likesCount: 7213,
    width: 600,
    height: 1000,
    mediaType: "video"
  },
  {
    id: "p14",
    title: "Mural Painting Process",
    description: "Creating vibrant street art graffiti with spray cans and details of outdoor mural active color strokes.",
    imageUrl: "https://assets.mixkit.co/videos/preview/mixkit-street-art-mural-painting-40248-large.mp4",
    category: "Explore",
    author: "art_creative",
    avatarUrl: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150",
    likesCount: 4210,
    width: 600,
    height: 1000,
    mediaType: "video"
  },
  {
    id: "p15",
    title: "Ocean Wave Power",
    description: "Intense bird-eye captures of deep turquoise waves rolling and breaking under pristine ocean foam gradients.",
    imageUrl: "https://assets.mixkit.co/videos/preview/mixkit-waves-breaking-in-the-ocean-1527-large.mp4",
    category: "Nature",
    author: "aqua_glade",
    avatarUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150",
    likesCount: 9840,
    width: 600,
    height: 1000,
    mediaType: "video"
  }
];

export const INITIAL_WEB_BOARDS: WebBoard[] = [
  { id: "b1", name: "Modern Interiors", count: 4, cover: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=300&q=80", isPrivate: false },
  { id: "b2", name: "Synth Gears", count: 12, cover: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=300&q=80", isPrivate: false },
  { id: "b3", name: "Bauhaus Study", count: 8, cover: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=300&q=80", isPrivate: true }
];
