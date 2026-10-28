type P = { size?: number };

const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);

export const PlayIcon = ({ size = 24 }: P) => svg(size, <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />);
export const PauseIcon = ({ size = 24 }: P) =>
  svg(
    size,
    <>
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </>,
  );
export const PrevIcon = ({ size = 22 }: P) =>
  svg(
    size,
    <>
      <rect x="5" y="5" width="2.4" height="14" rx="1" />
      <path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.3 13.1a1.3 1.3 0 0 1 0-2.2l8.15-5.53A1 1 0 0 1 19 6.2Z" />
    </>,
  );
export const NextIcon = ({ size = 22 }: P) =>
  svg(
    size,
    <>
      <rect x="16.6" y="5" width="2.4" height="14" rx="1" />
      <path d="M5 6.2v11.6a1 1 0 0 0 1.55.83l8.15-5.53a1.3 1.3 0 0 0 0-2.2L6.55 5.37A1 1 0 0 0 5 6.2Z" />
    </>,
  );
export const SunIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
  </svg>
);
export const MoonIcon = ({ size = 18 }: P) => svg(size, <path d="M20.2 14.6A8.5 8.5 0 0 1 9.4 3.8a.6.6 0 0 0-.8-.7 9.3 9.3 0 1 0 12.3 12.3.6.6 0 0 0-.7-.8Z" />);
export const PlusIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const CheckIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const CloseIcon = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const SendIcon = ({ size = 18 }: P) => svg(size, <path d="M3.4 11.1 19.6 4a.8.8 0 0 1 1.05 1.05L13.5 21.2a.8.8 0 0 1-1.48-.07l-2.1-6.1a1 1 0 0 0-.62-.62l-6.1-2.1a.8.8 0 0 1-.07-1.48Z" />);
export const UploadIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
);
export const HeartIcon = ({ size = 18, filled = false }: P & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20.3s-7.8-4.6-7.8-10.4A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 7.8 2.8c0 5.8-7.8 10.4-7.8 10.4Z" />
  </svg>
);
export const LogoutIcon = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3.5M10 16.5 5.5 12 10 7.5M5.5 12H15" />
  </svg>
);
export const LinkIcon =({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </svg>
);
