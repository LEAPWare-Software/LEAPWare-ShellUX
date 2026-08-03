/*
 * ONE PANE, RENDERED FROM ONE PLACE.
 *
 * The spike assembles the SAME two panes three ways — two WebContentsViews, two
 * sibling iframes in one document, two sibling divs in one document — so that a
 * difference in the measurements cannot be attributed to a difference in the
 * markup. That is only true if the markup is written once, which is what this
 * file is for.
 *
 * Every pane carries what ADR-0005's gate asks for: a unique h1, a labelled
 * landmark, and focusable controls. It also carries one thing the gate does not
 * name and the automated arms need — a control whose aria-labelledby and
 * aria-controls point at IDs that live in the OTHER pane. In one document those
 * IDREFs resolve and the control's accessible name becomes the other pane's
 * heading text. Across a document boundary they cannot resolve, and the name
 * falls back to the control's own text content. That fallback is the observable.
 *
 * The nav landmark is deliberately placed BEFORE the region, so that
 * `pane-<letter>-last` really is the last focusable element in the pane and the
 * Tab-traversal arm has an unambiguous starting point.
 */
(function () {
  'use strict';

  var ROLE = { a: 'list', b: 'detail' };
  var OTHER = { a: 'b', b: 'a' };

  function renderPane(container, letter) {
    var other = OTHER[letter];
    var upper = letter.toUpperCase();
    var self = 'pane-' + letter;
    var away = 'pane-' + other;

    container.innerHTML = [
      '<header>',
      '  <h1 id="' + self + '-heading">Pane ' + upper + ' heading, the ' + ROLE[letter] + ' pane</h1>',
      '</header>',
      '<nav id="' + self + '-nav" aria-label="Pane ' + upper + ' navigation">',
      '  <a id="' + self + '-nav-link" href="#' + self + '-region">Skip to the Pane ' + upper + ' region</a>',
      '</nav>',
      '<section id="' + self + '-region" aria-labelledby="' + self + '-heading">',
      '  <button id="' + self + '-first" type="button">Pane ' + upper + ' first control</button>',
      '  <p><label for="' + self + '-text">Pane ' + upper + ' text field</label>',
      '  <input id="' + self + '-text" type="text" value=""></p>',
      '  <button id="' + self + '-cross" type="button"',
      '          aria-labelledby="' + away + '-heading"',
      '          aria-controls="' + away + '-region">Pane ' + upper + ' cross reference control</button>',
      '  <button id="' + self + '-last" type="button">Pane ' + upper + ' last control</button>',
      '</section>',
    ].join('\n');
  }

  window.renderPane = renderPane;
})();
