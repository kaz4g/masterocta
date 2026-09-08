import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OperationsDialog } from './OperationsDialog';
function PreparedPlan() { const [review, setReview] = useState(''); return <input aria-label="Plan review" value={review} onChange={event => setReview(event.target.value)} />; }
describe('OperationsDialog', () => {
  it('preserves prepared operation state across close and reopen', () => {
    const close = vi.fn();
    const view = render(<OperationsDialog open busy={false} onClose={close}><PreparedPlan /></OperationsDialog>);
    fireEvent.change(screen.getByLabelText('Plan review'), { target: { value: 'reviewed-plan-id' } });
    view.rerender(<OperationsDialog open={false} busy={false} onClose={close}><PreparedPlan /></OperationsDialog>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(<OperationsDialog open busy={false} onClose={close}><PreparedPlan /></OperationsDialog>);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('Plan review')).toHaveValue('reviewed-plan-id');
  });
  it('prevents dismissal during an operation', () => {
    const close = vi.fn(); render(<OperationsDialog open busy onClose={close}>Applying</OperationsDialog>);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close operations' })).toBeDisabled();
  });
});
