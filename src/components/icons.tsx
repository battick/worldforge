import React from 'react';

interface P {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IcDashboard = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IcBook = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 0 4 22.5z" />
    <path d="M4 19.5A1.5 1.5 0 0 1 5.5 18H19" />
  </svg>
);

export const IcBox = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
    <path d="M3 8l9 5 9-5" />
    <path d="M12 13v8" />
  </svg>
);

export const IcSparkles = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" />
    <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
  </svg>
);

export const IcInbox = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M3 12h4l1.5 2.5h7L17 12h4" />
    <path d="M5.5 5h13l2.5 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
  </svg>
);

export const IcUpload = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M12 4v12" />
  </svg>
);

export const IcGraph = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="12" cy="5" r="2.4" />
    <circle cx="5" cy="18" r="2.4" />
    <circle cx="19" cy="18" r="2.4" />
    <path d="M10.6 7.1L6.4 15.9M13.4 7.1l4.2 8.8M7.4 18h9.2" />
  </svg>
);

export const IcTimeline = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M3 12h18" />
    <circle cx="7" cy="12" r="2.2" />
    <circle cx="17" cy="12" r="2.2" />
    <path d="M12 7.6V12" />
    <circle cx="12" cy="5.4" r="2.2" />
  </svg>
);

/** 时钟：条目「什么时候」那一块用它 */
export const IcClock = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.2V12l3.4 2" />
  </svg>
);

export const IcShield = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M12 3l7.5 3v6c0 4.6-3.1 8.4-7.5 9.6C7.6 20.4 4.5 16.6 4.5 12V6z" />
    <path d="M9.2 12.2l1.9 1.9 3.7-3.9" />
  </svg>
);

export const IcChat = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.3-3.9A7.5 7.5 0 1 1 20 12z" />
  </svg>
);

export const IcDownload = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 11l5 5 5-5" />
    <path d="M12 16V4" />
  </svg>
);

export const IcSettings = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1.1z" />
  </svg>
);

export const IcSearch = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const IcPlus = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IcTrash = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M4 7h16M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" />
    <path d="M6 7l1 12.2a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8L18 7" />
  </svg>
);

export const IcEdit = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M4 20h4L20 8a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="M14.5 6.5l3 3" />
  </svg>
);

export const IcClose = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IcCheck = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const IcRefresh = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M20 11a8 8 0 1 0-2.3 6.3" />
    <path d="M20 4.5V11h-6.5" />
  </svg>
);

export const IcLink = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 1 0-5.7-5.7L11.5 6.3" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 1 0 5.7 5.7l1.3-1.3" />
  </svg>
);

export const IcGlobe = ({ size = 16, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
  </svg>
);

export const IcChevron = ({ size = 14, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IcFile = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M14 3v5h5" />
    <path d="M19 8v11a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 19V5a1.8 1.8 0 0 1 1.8-1.8H14z" />
  </svg>
);

export const IcSwap = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M4 8h13M14 5l3 3-3 3" />
    <path d="M20 16H7M10 13l-3 3 3 3" />
  </svg>
);

export const IcWarn = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M12 3.5l9 15.5H3z" />
    <path d="M12 9.5v4.5M12 17h.01" />
  </svg>
);

export const IcStop = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

export const IcHistory = ({ size = 15, ...r }: P) => (
  <svg {...base(size)} {...r}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v5h5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);
