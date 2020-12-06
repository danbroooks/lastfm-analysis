import React from 'react';
import './App.css';

const fetchScrobbles = (() => {
  let cache = null;

  return () => {
    if (cache) {
      return Promise.resolve(cache)
    }
    else {
      return fetch('/data').then((response) => {
        return response.json();
      }).then((data) => {
        cache = data;
        return Promise.resolve(data);
      });
    }
  };
})();

class App extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      selected: null,
      scrobbles: null,
    };
  }

  componentDidMount() {
    fetchScrobbles().then(stats => {
      this.setState(stats);
    });
  }

  renderRow({ id, artist, track, timestamp }) {
    const rowStyles = {
      margin: '1em',
    };

    return (
      <div
        style={ rowStyles }
        onClick={ () => this.setState({ selected: id }) }
      >
        <p style={ ({ margin: 0 }) }>
          { artist }
        </p>
        <p style={ ({ margin: 0 }) }>
          { track }
        </p>
      </div>
    );
  }

  render() {
    return (
      <div className="App">
        { this.state.selected ? (
          <TrackInfo
            trackId={ this.state.selected }
          />
        ) : (
          this.state.scrobbles ? (
            this.state.scrobbles.map(row => this.renderRow(row))
          ) : (
            <p>
              Loading ...
            </p>
          )
        ) }
      </div>
    );
  }
}

class TrackInfo extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      plays: [],
    };
  }

  componentDidMount() {
    fetchScrobbles().then(({ scrobbles }) => {
      this.setState({ plays: scrobbles.filter(_ => _.id == this.props.trackId) });
    });
  }

  render() {
    return (
      <div>
        <p>
          { this.props.trackId }
        </p>
        { this.state.plays.map((scrobble) => this.renderScrobble(scrobble)) }
      </div>
    );
  }

  renderScrobble({ id, artist, track, timestamp }) {
    const rowStyles = {
      margin: '1em',
    };

    return (
      <div
        style={ rowStyles }
        onClick={ () => this.setState({ selected: id }) }
      >
        <p style={ ({ margin: 0 }) }>
          { timestamp }
        </p>
      </div>
    );
  }


}

export default App;
