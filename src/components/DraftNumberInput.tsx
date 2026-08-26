import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';

interface DraftNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  value: number;
  onCommit: (value: number) => void;
}

export function DraftNumberInput({ value, onCommit, ...props }: DraftNumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const editingRef = useRef(false);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(String(value));
  }, [value]);

  function commit(input: HTMLInputElement, reportInvalid: boolean) {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (!trimmed || !Number.isFinite(parsed) || !input.checkValidity()) {
      if (reportInvalid) input.reportValidity();
      else setDraft(String(value));
      return false;
    }
    onCommit(parsed);
    setDraft(String(parsed));
    return true;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(event.currentTarget, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      setDraft(String(value));
      event.currentTarget.blur();
    }
  }

  return <input
    {...props}
    type="number"
    value={draft}
    onFocus={() => { editingRef.current = true; }}
    onChange={(event) => setDraft(event.target.value)}
    onKeyDown={handleKeyDown}
    onBlur={(event) => {
      editingRef.current = false;
      if (skipBlurCommitRef.current) skipBlurCommitRef.current = false;
      else commit(event.currentTarget, false);
    }}
  />;
}
