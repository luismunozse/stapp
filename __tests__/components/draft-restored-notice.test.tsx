import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ModalProvider } from '@/contexts/modal-context'
import { DraftRestoredNotice } from '@/components/ui/draft-restored-notice'

function renderNotice(onDiscard: () => void) {
  return render(
    <ModalProvider>
      <DraftRestoredNotice onDiscard={onDiscard} />
    </ModalProvider>,
  )
}

describe('DraftRestoredNotice', () => {
  it('shows the restore message', () => {
    renderNotice(vi.fn())

    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
  })

  it('asks for confirmation before discarding: a single click is not enough', async () => {
    // "Descartar" ends in clearDraft(), an irreversible localStorage.removeItem
    // plus a form reset, and this notice sits at the very top of the form body
    // (orden-form.tsx), right above the step indicator and the customer picker.
    // Every other destructive action in these forms goes through useModal.
    const onDiscard = vi.fn()
    renderNotice(onDiscard)

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(onDiscard).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole('button', { name: 'Descartar borrador' }))
    await waitFor(() => expect(onDiscard).toHaveBeenCalledTimes(1))
  })

  it('keeps the draft when the confirmation is dismissed', async () => {
    const onDiscard = vi.fn()
    renderNotice(onDiscard)

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir editando' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Seguir editando' })).not.toBeInTheDocument(),
    )
    expect(onDiscard).not.toHaveBeenCalled()
  })
})
