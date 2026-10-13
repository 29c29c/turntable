import { useEffect } from 'react';

export default function useDialogKeyboard() {
  useEffect(() => {
    let previousFocus: HTMLElement | null = null;
    let previousDialog: HTMLElement | null = null;
    const focusables = (dialog: HTMLElement) =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]',
        ),
      ].filter((el) => el.getClientRects().length);
    const observe = () => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog && dialog !== previousDialog) {
        previousFocus = document.activeElement as HTMLElement;
        previousDialog = dialog;
        if (!dialog.contains(document.activeElement)) focusables(dialog)[0]?.focus();
      } else if (!dialog && previousDialog) {
        previousFocus?.focus();
        previousDialog = null;
      }
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { childList: true, subtree: true });
    const onKey = (e: KeyboardEvent) => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      if (e.key === 'Escape') {
        dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const elements = focusables(dialog),
        first = elements[0],
        last = elements.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKey);
    };
  }, []);
}
