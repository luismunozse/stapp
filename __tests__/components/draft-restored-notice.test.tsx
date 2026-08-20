import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DraftRestoredNotice } from '@/components/ui/draft-restored-notice'

describe('DraftRestoredNotice', () => {
  it('shows the restore message and calls onDiscard when dismissed', () => {
    const onDiscard = vi.fn()
    render(<DraftRestoredNotice onDiscard={onDiscard} />)

    expect(screen.getByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /descartar/i }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })
})
