import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { ResultsView } from '../src/components/results/ResultsView';

import { expectNoA11yViolations } from './a11y';
import { fx, server } from './msw';
import { renderWithProviders } from './render';

function setup() {
  const onShowPrimaryQuote = vi.fn();
  const utils = renderWithProviders(
    <ResultsView results={fx.results()} onShowPrimaryQuote={onShowPrimaryQuote} />,
  );
  return { ...utils, onShowPrimaryQuote };
}

const card = (drug: string) => screen.getByRole('article', { name: drug });

describe('ResultsView — verification', () => {
  it('labels fixture output honestly and shows the summary', () => {
    setup();
    expect(screen.getByText('Fixture outputs (not a live model)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });

  it('counts each status and groups medications, problems first', () => {
    setup();
    const tiles = within(screen.getByRole('group', { name: /filter by status/i }));
    expect(tiles.getByRole('button', { name: /^contradicted:\s*3/i })).toBeEnabled();
    expect(tiles.getByRole('button', { name: /^unsupported:\s*1/i })).toBeEnabled();
    expect(tiles.getByRole('button', { name: /^supported:\s*2/i })).toBeEnabled();
    expect(tiles.getByRole('button', { name: /^incomplete:\s*0/i })).toBeDisabled();

    const names = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(names.slice(0, 3).sort()).toEqual(['Cordizem-XR', 'Etrazolam', 'Pravoxil']);
    expect(names[3]).toBe('Pranixol');
    expect(within(card('Pranixol')).getByText(/similar-looking monograph/i)).toHaveTextContent(
      'Pravoxil',
    );
  });

  it('filters by status from the tiles and clears the filter', async () => {
    const { user } = setup();
    const tile = screen.getByRole('button', { name: /^unsupported:\s*1/i });
    await user.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('article').map((a) => a.textContent)).toHaveLength(1);
    expect(card('Pranixol')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show all/i }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('shows conflicts up front and reveals other checks on demand', async () => {
    const { user } = setup();
    const pravoxil = within(card('Pravoxil'));
    expect(pravoxil.getByRole('list', { name: /pravoxil conflicts/i })).toHaveTextContent(
      /timing/i,
    );
    const supported = within(card('Velantine'));
    const toggle = supported.getByRole('button', { name: /show \d+ other checks/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens the citation sheet with the full retrieved passage', async () => {
    server.use(
      http.get('/api/references/:ref/chunks/:chunk', () =>
        HttpResponse.json({
          ...fx.results().verifications[0]!.findings[0]!.citation,
          text: 'Prescribing notes: Pravoxil should be taken at bedtime, not in the morning.',
        }),
      ),
    );
    const { user } = setup();
    const cite = within(card('Pravoxil'))
      .getAllByRole('button')
      .find((b) => /p\.\d+: “/.test(b.textContent ?? ''))!;
    await user.click(cite);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/quote verified in source/i)).toBeInTheDocument();
    expect(await within(dialog).findByText(/full retrieved passage/i)).toBeInTheDocument();
  });
});

describe('ResultsView — critical points and medications', () => {
  it('lists the document discrepancy with both quotes and opens a quote in the viewer', async () => {
    const { user, onShowPrimaryQuote } = setup();
    await user.click(screen.getByRole('tab', { name: /critical points/i }));
    const discrepancy = screen
      .getAllByRole('listitem')
      .find((li) => /inconsistency in document/i.test(li.textContent ?? ''))!;
    const quotes = within(discrepancy).getAllByRole('button', { name: /primary doc p\./i });
    expect(quotes).toHaveLength(2);
    await user.click(quotes[1]!);
    expect(onShowPrimaryQuote).toHaveBeenCalledWith(5, expect.stringMatching(/8-week mark/));
  });

  it('jumps from a critical point to that drug’s verification and focuses it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /critical points/i }));
    await user.click(
      screen.getAllByRole('button', {
        name: /formulary check: contradicted — show etrazolam/i,
      })[0]!,
    );
    expect(screen.getByRole('tab', { name: /verification/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(card('Etrazolam')).toHaveFocus());
  });

  it('renders the extracted medications as an accessible table', async () => {
    const { user, onShowPrimaryQuote } = setup();
    await user.click(screen.getByRole('tab', { name: /medications/i }));
    const table = screen.getByRole('table', { name: /medications extracted/i });
    expect(within(table).getAllByRole('row')).toHaveLength(7); // header + 6
    await user.click(within(table).getByRole('button', { name: /show cordizem-xr prescription/i }));
    expect(onShowPrimaryQuote).toHaveBeenCalledWith(3, expect.stringContaining('Cordizem-XR'));
  });

  it('has no detectable accessibility violations on any tab', async () => {
    const { user, container } = setup();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('tab', { name: /critical points/i }));
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('tab', { name: /medications/i }));
    await expectNoA11yViolations(container);
  });
});

describe('ResultsView — needs attention and parameter strip', () => {
  it('lists what needs attention, problems first, with the reason, and jumps to the card', async () => {
    const { user } = setup();
    const panel = within(screen.getByRole('list', { name: /medications needing attention/i }));
    const rows = panel.getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Cordizem-XR.*Conflicts on dose/),
      expect.stringMatching(/Pravoxil.*Conflicts on timing/),
      expect.stringMatching(/Etrazolam.*Conflicts on duration/),
      expect.stringMatching(/Pranixol.*coverage gap/),
    ]);
    await user.click(panel.getByRole('button', { name: /show pranixol details/i }));
    await waitFor(() => expect(card('Pranixol')).toHaveFocus());
  });

  it('shows every parameter outcome on the card without expanding it', () => {
    setup();
    const strip = within(
      within(card('Velantine')).getByRole('list', { name: /checks by parameter/i }),
    );
    expect(strip.getByText(/^Dose/)).toHaveTextContent(/consistent/);
    expect(strip.getByText(/^Timing/)).toHaveTextContent(/no rule in the formulary/);
    const pravoxil = within(
      within(card('Pravoxil')).getByRole('list', { name: /checks by parameter/i }),
    );
    expect(pravoxil.getByText(/^Timing/)).toHaveTextContent(/conflict/);
  });

  it('can be driven from the keyboard (tabs with arrow keys, filter tiles with Enter)', async () => {
    const { user } = setup();
    const verification = screen.getByRole('tab', { name: /verification/i });
    verification.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /critical points/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowLeft}');
    const tile = screen.getByRole('button', { name: /^unsupported:\s*1/i });
    tile.focus();
    await user.keyboard('{Enter}');
    expect(tile).toHaveAttribute('aria-pressed', 'true');
  });
});
