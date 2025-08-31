import { render, screen, fireEvent } from '@testing-library/react';
import UIPanel from './UIPanel';

describe('UIPanel', () => {
  const mockCtx = {} as CanvasRenderingContext2D;

  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({}),
      }) as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders create and join buttons', () => {
    render(<UIPanel ctx={mockCtx} />);
    expect(screen.getByText('Create Game')).toBeInTheDocument();
    expect(screen.getByText('Join Game')).toBeInTheDocument();
  });

  it('invokes fetch when creating a game', async () => {
    render(<UIPanel ctx={mockCtx} />);
    const createButton = screen.getByText('Create Game');
    await fireEvent.click(createButton);
    expect(global.fetch).toHaveBeenCalled();
  });
});
