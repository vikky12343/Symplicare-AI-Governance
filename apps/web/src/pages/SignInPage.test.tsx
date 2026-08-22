import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { SignInPage } from './SignInPage.js';

/* The page only needs the session state; the network is never reached here. */
vi.mock('../lib/hooks.js', () => ({
  useAuth: () => ({ user: null, organisation: null, loading: false, refresh: vi.fn(), signOut: vi.fn() }),
}));

describe('SignInPage', () => {
  it('renders the sign-in form', () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
  });

  it('offers a way back to the homepage', () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /back to homepage/i })).toHaveAttribute('href', '/');
  });
});
