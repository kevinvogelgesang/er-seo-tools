import { useState, useEffect, useRef } from 'react';

interface Client {
  id: number;
  name: string;
  domains: string[];
}

export function useClientCombobox(clients: Client[], selectedName: string | null) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selectedName ?? '');
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [selectedName]);

  const filtered = query === '' || query === selectedName
    ? clients
    : clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));

  return { query, setQuery, open, setOpen, comboRef, filtered };
}
