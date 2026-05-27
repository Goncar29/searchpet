const React = require('react');
const { View } = require('react-native');

const MockMapView = (props) => React.createElement(View, props);
MockMapView.displayName = 'MapView';

const MockMarker = (props) => React.createElement(View, props);
MockMarker.displayName = 'Marker';

const MockCallout = (props) => React.createElement(View, props);
MockCallout.displayName = 'Callout';

module.exports = {
  default: MockMapView,
  Marker: MockMarker,
  Callout: MockCallout,
  PROVIDER_GOOGLE: 'google',
};
