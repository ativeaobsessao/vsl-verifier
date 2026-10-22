const vturb = require('./vturb_detector');
const wistia = require('./wistia_detector');
const panda = require('./panda_detector');
const youtube = require('./youtube_detector');
const checkout = require('./checkout_detector');

module.exports = {
  detectors: [vturb, wistia, panda, youtube],
  checkout,
  vturb,
  wistia,
  panda,
  youtube
};
