const express = require('express');
const bodyParser = require('body-parser')
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const crypto = require('crypto');
const {
  differenceInSeconds,
  formatDuration,
  formatISO: formatISODate,
  getMonth,
  getYear,
  intervalToDuration,
  isBefore,
  min: minDate,
  max: maxDate,
  parse: parseDate,
  parseISO: parseISODate,
} = require('date-fns');
const _ = require('lodash');
const app = express();

app.use(express.static(path.join(__dirname, 'build')));

const loadFile = (filePath) => new Promise((res, rej) => {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      rej(err);
    }
    else {
      res(content);
    }
  });
});

const saveFile = (filePath, content) => new Promise((res, rej) => {
  fs.writeFile(filePath, content, (err) => {
    if (err) {
      rej(err);
    }
    else {
      res();
    }
  });
});

const loadCSV = filePath => new Promise((res, rej) => {
  const rows = [];

  fs.createReadStream(filePath)
    .pipe(csv(['artist', 'album', 'title', 'timestamp']))
    .on('data', (row) => {
      if (row.timestamp) { // filter scrobbles missing timestamps
        const parsedTimestamp = parseDate(row.timestamp, 'dd MMM yyyy HH:mm', new Date);
        const scrobble = {
          ...row,
          timestamp: parsedTimestamp,
        };

        if (isValidScrobble(scrobble)) {
          rows.push(scrobble);
        }
      }
    })
    .on('end', () => {
      res(rows);
    });
});

const isValidScrobble = scrob => {
  return !isBefore(scrob.timestamp, new Date(2000, 1, 1)); // ignore nonsense timestamps
};

const loadData = () => {
  return cachedJSON('lastfm-data.json', () => {
    return loadCSV('./lastfm-data.csv').then(csvData => {
      return csvData.map((row) => {
        const contentAddressable = {
          artist: row.artist,
          title: row.title,
        };

        return {
          ...row,
          timestamp: formatISODate(row.timestamp),
          id: crypto.createHash('sha256').update(JSON.stringify(contentAddressable)).digest('hex'),
        };
      });
    });
  }).then((data) => {
    return data.map(row => ({
      ...row,
      timestamp: parseISODate(row.timestamp),
    }));
  });
};

const cached = (cacheFile, action) => {
  const cachePath = `.cache/${cacheFile}`;

  return new Promise((res) => {
    return loadFile(cachePath)
      .then(res)
      .catch(() => {
        action().then(result => {
          saveFile(cachePath, result).then(() => {
            res(result);
          });
        });
      });
  });
};

const cachedJSON = (cacheFile, action) =>
  cached(cacheFile, () => {
    return action().then(_ => JSON.stringify(_))
  }).then((cachedJson) => {
    return Promise.resolve(JSON.parse(cachedJson));
  });

const loadStats = () => {
  return loadData().then(scrobbles => {
    return cachedJSON('lastfm-grouped-scrobbles.json', () => {
      console.log('Processing data...');
      return Promise.resolve(scrobbles.reduce((acc, scrob) => {
        let entry = acc[scrob.id];

        entry = entry || {
          ...scrob,
          plays: [],
        };

        return {
          ...acc,
          [scrob.id]: {
            ...entry,
            plays: entry.plays.concat([scrob.timestamp])
          }
        };
      }, {}));
    }).then((stats) => {
      return Promise.resolve({
        stats: _.mapValues(stats, row => ({
          ...row,
          plays: row.plays.map(parseISODate),
        })),
        scrobbles
      });
    });
  });
};

const isSummer = d => [5, 6, 7].includes(getMonth(d));

const isAutumn = d => [8, 9, 10].includes(getMonth(d));

const isWinter = d => [11, 0, 1].includes(getMonth(d));

const isSpring = d => [2, 3, 4].includes(getMonth(d));

const getSeasonYear = d => {
  if (getMonth(d) === 11) {
    return getYear(d) + 1;
  }
  else {
    return getYear(d);
  }
}

const getSeasonalWeight = (plays, seasonPred) => {
  const filteredPlays = plays.filter(seasonPred);
  const totalPlaysBySeasonYear = _.countBy(plays, getSeasonYear);
  const playsBySeasonYear = _.omitBy(_.countBy(filteredPlays, getSeasonYear), (nPlays, year) => {
    return nPlays < 2 || nPlays < Math.ceil(totalPlaysBySeasonYear[year] / 2);
  });

  // only counts of seasonal if the plays occur in season at least twice
  const countsAsSeasonal = Object.keys(playsBySeasonYear).length > 1;

  if (countsAsSeasonal) {
    return filteredPlays.length / plays.length;
  }
  else {
    return 0;
  }
};

const additionalTrackMetrics = track => {
  return {
    firstPlay: minDate(track.plays),
    lastPlay: maxDate(track.plays),
    summerWeight: getSeasonalWeight(track.plays, isSummer),
    autumnWeight: getSeasonalWeight(track.plays, isAutumn),
    winterWeight: getSeasonalWeight(track.plays, isWinter),
    springWeight: getSeasonalWeight(track.plays, isSpring),
  };
};

const loadMultiplays = () => {
  return loadStats().then(({ stats }) => {
    const extraStats = _.values(stats).map(o => ({
      ...o,
      ...additionalTrackMetrics(o)
    }));

    return Promise.resolve(
      _.filter(extraStats, ({ plays }) => plays.length > 3)
    );
  });
};

const numberOfPlays = track => track.plays.length;

const getPlayWindowInSeconds = (track) => {
  return differenceInSeconds(track.lastPlay, track.firstPlay);
};

const logTrackName = track =>
  console.log(toTrackNameStr(track));

const toTrackNameStr = track =>
  `${track.artist} - ${track.title}`;

const dayInSeconds =
  60 * 60 * 24

const formatInterval = ({ start, end }) => {
  const interval = intervalToDuration({ start, end });

  const opts = {
    delimiter: ', ',
    format: roundedIntervalUnits(interval)
  };

  const formattedStr = formatDuration(interval, opts);

  if (!formattedStr) {
    console.log(interval);
    console.log(opts);
    throw new Error();
  }

  return formattedStr;
};

const formatSince = date => {
  const intervalStr = formatInterval({
    start: date,
    end: new Date,
  });

  return `${intervalStr} ago`;
};

const roundedIntervalUnits = interval => {
  const unitOrder = [
    'years',
    'months',
    'days',
    'hours',
    'minutes',
    'seconds',
  ];

  const biggest = _.findIndex(unitOrder, unit => {
    return interval[unit] !== 0;
  });

  const unitIndex = (biggest !== -1) ? biggest : (unitOrder.length - 1);

  return [unitOrder[unitIndex], unitOrder[unitIndex + 1]].filter(Boolean);
};

const formatPlayWindow = track => formatInterval({
  start: track.firstPlay,
  end: track.lastPlay,
});

const topBy = (data, n, by) => _.reverse(_.takeRight(_.sortBy(data, by), n));

const isHeavilyPlayed = track => track.plays.length > 5;

const perTotalPlays = (track, f) => {
  const filteredPlays = track.plays.filter(f);
  return Math.floor((filteredPlays.length / track.plays.length) * 100)
};

const gets = path => o => _.get(o, path);

loadMultiplays()
  .then(_.values)
  .then((tracks) => {
    console.log('Most played:');
    topBy(tracks, 5, numberOfPlays).forEach(track => {
      console.log();
      logTrackName(track);
      console.log(`${track.plays.length} plays`);
    });

    const springPlays = topBy(tracks.filter(isHeavilyPlayed), 20, gets('springWeight')).filter(gets('springWeight'));
    const summerPlays = topBy(tracks.filter(isHeavilyPlayed), 20, gets('summerWeight')).filter(gets('summerWeight'));
    const autumnPlays = topBy(tracks.filter(isHeavilyPlayed), 20, gets('autumnWeight')).filter(gets('autumnWeight'));
    const winterPlays = topBy(tracks.filter(isHeavilyPlayed), 20, gets('winterWeight')).filter(gets('winterWeight'));
    const duplicateSeasonalResults = _.intersection(
      springPlays.map(gets('id')),
      summerPlays.map(gets('id')),
      autumnPlays.map(gets('id')),
      winterPlays.map(gets('id'))
    );

    console.log();
    console.log('Most played in spring:');
    console.log();
    springPlays.forEach(track => {
      console.log(`${toTrackNameStr(track)} (${perTotalPlays(track, isSpring)}% of ${track.plays.length} total plays)`);
      // console.log(` of this track's ${track.plays.length} plays were in spring`);
    });

    console.log();
    console.log('Most played in summer:');
    console.log();
    summerPlays.forEach(track => {
      console.log(`${toTrackNameStr(track)} (${perTotalPlays(track, isSummer)}% of ${track.plays.length} total plays)`);
    });

    console.log();
    console.log('Most played in autumn:');
    console.log();
    autumnPlays.forEach(track => {
      // console.log(`${Math.floor(track.autumnWeight * 100)}% of this track's ${track.plays.length} plays were in autumn`);
      console.log(`${toTrackNameStr(track)} (${perTotalPlays(track, isAutumn)}% of ${track.plays.length} total plays)`);
    });

    console.log();
    console.log('Most played in winter:');
    console.log();
    winterPlays.forEach(track => {
      console.log(`${toTrackNameStr(track)} (${perTotalPlays(track, isWinter)}% of ${track.plays.length} total plays)`);
      // console.log(`${Math.floor(track.winterWeight * 100)}% of this track's ${track.plays.length} plays were in winter`);
    });

    if (duplicateSeasonalResults.length) {
      console.log(duplicateSeasonalResults);
      throw new Error();
    }

    const sortedByPlayWindow = _.sortBy(tracks, getPlayWindowInSeconds);

    console.log('');
    console.log('Biggest play window:');
    topBy(tracks, 10, getPlayWindowInSeconds).forEach(track => {
      console.log();
      logTrackName(track);
      console.log(formatPlayWindow(track));
    });
  });

app.get('/data', function (req, res) {
  loadStats().then(stats => {
    res.send(JSON.stringify(stats));
  });
});

app.listen(process.env.PORT || 8080);
