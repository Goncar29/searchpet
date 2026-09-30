// Pet types and photo controls in the publish forms draw registry icons.
import React from 'react';
import { render } from '@testing-library/react-native';
import { StrayFormStep } from '../components/publish/StrayFormStep';
import { AdoptionFormStep } from '../components/publish/AdoptionFormStep';
import { PET_TYPES } from '../constants';
import { ICON_PATHS } from '../../shared/icons/paths';
import { drawnIcons, emojiTexts } from './support/icons';

const emptyIdentity = { gender: '', birth: { year: '', month: '', day: '' } } as const;

describe('publish forms', () => {
  const stray = {
    type: '',
    breed: '',
    color: '',
    description: '',
    photos: [] as string[],
    identity: emptyIdentity,
  };

  it('StrayFormStep: camera button and one icon per pet type (dog, cat, bird, pets)', () => {
    const ui = render(<StrayFormStep value={stray as never} onChange={jest.fn()} onNext={jest.fn()} />);
    const icons = drawnIcons(ui);
    expect(icons).toContain('photo-camera');
    expect(icons).toEqual(expect.arrayContaining(['dog', 'cat', 'bird', 'pets']));
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('StrayFormStep: a picked photo gets a close icon instead of the cross glyph', () => {
    const ui = render(
      <StrayFormStep
        value={{ ...stray, photos: ['file:///a.jpg'] } as never}
        onChange={jest.fn()}
        onNext={jest.fn()}
      />,
    );
    expect(drawnIcons(ui)).toContain('close');
    expect(emojiTexts(ui)).toEqual([]);
  });

  const adoption = { ...stray, city: '' };

  it('AdoptionFormStep: camera button and one icon per pet type', () => {
    const ui = render(
      <AdoptionFormStep value={adoption as never} onChange={jest.fn()} onSubmit={jest.fn()} isPending={false} />,
    );
    const icons = drawnIcons(ui);
    expect(icons).toContain('photo-camera');
    expect(icons).toEqual(expect.arrayContaining(['dog', 'cat', 'bird', 'pets']));
    expect(emojiTexts(ui)).toEqual([]);
  });

  it('AdoptionFormStep: a picked photo gets a close icon', () => {
    const ui = render(
      <AdoptionFormStep
        value={{ ...adoption, photos: ['file:///a.jpg'] } as never}
        onChange={jest.fn()}
        onSubmit={jest.fn()}
        isPending={false}
      />,
    );
    expect(drawnIcons(ui)).toContain('close');
    expect(emojiTexts(ui)).toEqual([]);
  });
});

describe('PET_TYPES', () => {
  it('gives every type its own registry icon (dog, cat, bird, pets)', () => {
    expect(PET_TYPES.map((t) => [t.value, t.icon])).toEqual([
      ['perro', 'dog'],
      ['gato', 'cat'],
      ['pajaro', 'bird'],
      ['otro', 'pets'],
    ]);
    const paths = PET_TYPES.map((t) => ICON_PATHS[t.icon]);
    expect(new Set(paths).size).toBe(PET_TYPES.length);
  });
});
