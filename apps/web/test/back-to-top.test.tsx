import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackToTop } from '../src/components/BackToTop';

const scrollPage = (y: number) =>
  act(() => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new Event('scroll'));
  });

afterEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

describe('BackToTop', () => {
  it('appears only after the page has scrolled, then scrolls to the top and focuses main', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    render(
      <>
        <main id="main" tabIndex={-1} />
        <BackToTop />
      </>,
    );
    // At the top it is hidden from assistive tech and the tab order.
    expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();

    scrollPage(1200);
    const button = await screen.findByRole('button', { name: 'Back to top' });
    expect(button).toHaveAttribute('tabindex', '0');

    await userEvent.click(button);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(screen.getByRole('main')).toHaveFocus();

    scrollPage(100);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument(),
    );
  });
});
