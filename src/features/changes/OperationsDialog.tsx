import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../design-system';
import './OperationsDialog.css';

/** Native dialog hides without unmounting the safety/plan coordinators. */
export function OperationsDialog({ open, busy, onClose, children }: {
  open: boolean; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return <dialog ref={dialog} className="mo-operations-dialog" aria-label="File operations"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>File operations</h2><Button variant="secondary" disabled={busy} onClick={onClose}>Close operations</Button></header>
    {children}
  </dialog>;
}
