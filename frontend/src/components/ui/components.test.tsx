import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { DataTable } from './data-table';
import { Dialog } from './dialog';
import { FormField, Select, TextInput } from './form-field';
import { PageHeader } from './page-header';
import { EmptyState, ErrorState, LoadingState, Skeleton } from './states';

describe('FormField', () => {
  it('links label, hint and error to the control for screen readers', () => {
    render(
      <FormField label="Ingredient name" hint="Shown on recipes" error="Name is required" required>
        <TextInput />
      </FormField>,
    );
    const input = screen.getByLabelText(/Ingredient name/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Shown on recipes Name is required');
  });

  it('is valid and undescribed without hint or error; works with Select', () => {
    render(
      <FormField label="Unit">
        <Select defaultValue="G">
          <option value="G">Grams</option>
          <option value="ML">Millilitres</option>
        </Select>
      </FormField>,
    );
    const select = screen.getByLabelText('Unit');
    expect(select).not.toHaveAttribute('aria-invalid');
    expect(select).not.toHaveAttribute('aria-describedby');
    expect(select).toHaveValue('G');
  });
});

describe('Dialog', () => {
  function ConfirmExample({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Deactivate
        </Button>
        <Dialog
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          title="Deactivate staff member?"
          description="They will be signed out immediately."
          footer={
            <Button
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              Confirm
            </Button>
          }
        />
      </>
    );
  }

  it('opens with an accessible name/description, runs the action and restores focus', () => {
    const onConfirm = vi.fn();
    render(<ConfirmExample onConfirm={onConfirm} />);
    const trigger = screen.getByRole('button', { name: 'Deactivate' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Deactivate staff member?' });
    expect(dialog).toHaveAccessibleDescription('They will be signed out immediately.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByText('They will be signed out immediately.')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Escape and on a backdrop click without running the action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmExample onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('DataTable', () => {
  const columns = [
    { key: 'name', header: 'Name', cell: (row: { id: string; name: string; qty: number }) => row.name },
    { key: 'qty', header: 'Quantity', align: 'right' as const, cell: (row: { qty: number }) => row.qty },
  ];

  it('renders a captioned, semantic table with column headers', () => {
    render(
      <DataTable
        caption="Ingredients"
        columns={columns}
        rows={[{ id: '1', name: 'Rice', qty: 5 }]}
        getRowKey={(row) => row.id}
      />,
    );
    const table = screen.getByRole('table', { name: 'Ingredients' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Name', 'Quantity']);
    expect(within(table).getByRole('cell', { name: 'Rice' })).toBeInTheDocument();
  });

  it('shows the provided empty state instead of an empty table', () => {
    render(
      <DataTable
        caption="Ingredients"
        columns={columns}
        rows={[]}
        getRowKey={(row) => row.id}
        empty={<EmptyState title="No ingredients yet" />}
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No ingredients yet' })).toBeInTheDocument();
  });
});

describe('page and state components', () => {
  it('PageHeader renders the single page h1 with eyebrow, description and actions', () => {
    render(<PageHeader eyebrow="Inventory" title="Ingredients" description="Track stock." actions={<Button>Add</Button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Ingredients' })).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('ErrorState is announced and offers a retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="The server could not be reached." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The server could not be reached.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('LoadingState exposes a status; Skeleton is hidden from assistive technology and motion-safe', () => {
    const { container } = render(
      <>
        <LoadingState label="Loading orders" />
        <Skeleton className="h-4" />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading orders');
    const skeleton = container.querySelector('[aria-hidden="true"].animate-pulse');
    expect(skeleton?.className).toContain('motion-reduce:animate-none');
  });
});
