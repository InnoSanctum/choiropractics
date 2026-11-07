import { useEffect, useState } from 'react';

/** Phones: narrow screens, or short touch screens (phone in landscape). */
const QUERY = '(max-width: 767px), (max-height: 520px) and (pointer: coarse)';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(QUERY);
}

/** Very little vertical room (phone in landscape): use the slimmest bars. */
export function useIsShortScreen(): boolean {
  return useMediaQuery('(max-height: 500px)');
}
