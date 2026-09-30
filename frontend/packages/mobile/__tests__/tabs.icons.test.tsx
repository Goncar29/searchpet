// The tab bar draws registry icons (no emoji) and tints them by focus.
//
// `Tabs` is replaced by a stub that does what react-navigation does with
// `tabBarIcon`: call it with `{ focused, color }`, where `color` is the active
// or inactive tint from `screenOptions`. That is why the assertions read the
// drawn `Path` fill — the tab bar must take its color from that prop instead of
// dimming with opacity.
import React from 'react';
import { render } from '@testing-library/react-native';
import { Path } from 'react-native-svg';
import TabsLayout from '../app/(tabs)/_layout';
import { ICON_PATHS } from '../../shared/icons/paths';
import { COLORS } from '../constants';

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Tabs = ({ children, screenOptions }: any) =>
    React.createElement(
      View,
      null,
      React.Children.map(children, (child: any) =>
        React.cloneElement(child, { screenOptions }),
      ),
    );
  Tabs.Screen = ({ name, options, screenOptions }: any) =>
    React.createElement(
      View,
      { testID: `tab-${name}` },
      [true, false].map((focused) =>
        React.createElement(
          View,
          { key: String(focused), testID: `tab-${name}-${focused ? 'active' : 'idle'}` },
          options.tabBarIcon({
            focused,
            size: 24,
            color: focused ? screenOptions.tabBarActiveTintColor : screenOptions.tabBarInactiveTintColor,
          }),
        ),
      ),
    );
  return { Tabs };
});

jest.mock('@shared/hooks', () => ({
  useUnreadCount: () => ({ data: { count: 0 } }),
}));

jest.mock('../store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ isAuthenticated: true }),
}));

const EXPECTED: Record<string, keyof typeof ICON_PATHS> = {
  index: 'home',
  map: 'map',
  post: 'add',
  messages: 'chat-bubble',
  profile: 'person',
};

function pathOf(ui: ReturnType<typeof render>, id: string) {
  return ui.getByTestId(id).findByType(Path).props;
}

describe('tab bar icons', () => {
  it.each(Object.entries(EXPECTED))('the %s tab draws the %s registry icon', (tab, icon) => {
    const ui = render(<TabsLayout />);
    expect(pathOf(ui, `tab-${tab}-active`).d).toBe(ICON_PATHS[icon]);
    expect(pathOf(ui, `tab-${tab}-idle`).d).toBe(ICON_PATHS[icon]);
  });

  it('the five tabs draw five different icons', () => {
    const ui = render(<TabsLayout />);
    const drawn = Object.keys(EXPECTED).map((tab) => pathOf(ui, `tab-${tab}-active`).d);
    expect(new Set(drawn).size).toBe(5);
  });

  it('the active tab is primary and the inactive tab is muted (both halves)', () => {
    const ui = render(<TabsLayout />);
    for (const tab of Object.keys(EXPECTED)) {
      expect(pathOf(ui, `tab-${tab}-active`).fill).toBe(COLORS.primary);
      expect(pathOf(ui, `tab-${tab}-idle`).fill).toBe(COLORS.textMuted);
    }
  });

  it('draws no emoji text in the tab bar', () => {
    const ui = render(<TabsLayout />);
    const text = JSON.stringify(ui.toJSON());
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});
