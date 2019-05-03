'use strict';

//--------------------------------
// Load Enviroment Variables from the .env file
//--------------------------------
require('dotenv').config();

//--------------------------------
//--------------------------------
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

//--------------------------------
//Application setup
//--------------------------------
const PORT = process.env.PORT || 3000;
const app = express();
app.use(cors({
  origin: 'localhost:8080',
}));


//--------------------------------
// Database Config
//--------------------------------

// 1. Create a client with connection url
const client = new pg.Client(process.env.DATABASE_URL);

// 2. Connect client
client.connect();

// 3. Add event listeners
client.on('err', err => console.error(err));

//--------------------------------
// Error Message
//--------------------------------
let errorMessage = () => {
  let errorObj = {
    status: 500,
    responseText: 'Sorry something went wrong',
  };
  console.log(errorObj);
  return errorObj;
};

//--------------------------------
// Helper functions
//--------------------------------
let lookup = (handler) => {
  const SQL = `SELECT * FROM ${handler.tableName} WHERE location_id=$1`;

  return client.query(SQL, [handler.location.id])
    .then(result => {
      if(result.rowCount > 0){
        handler.cacheHit(result);
      }else{
        handler.cacheMiss();
      }
    })
    .catch(errorMessage);
};

let deleteByLocationId = (table, location_id) => {
  const SQL = `DELETE FROM ${table} WHERE location_id=${location_id}`;

  return client.query(SQL);
};

const timeouts = {
  weather: 15 * 1000,
  // events: 15 * 1000
};
//--------------------------------
// Constructors Functions
//--------------------------------
function Location(query, geoData) {
  this.search_query = query;
  this.formatted_query = geoData.formatted_address;
  this.latitude = geoData.geometry.location.lat;
  this.longitude = geoData.geometry.location.lng;
}

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toDateString();
  this.created_at = Date.now();
}

Weather.tableName = 'weathers';
Weather.lookup = lookup;
Weather.deleteByLocationId = deleteByLocationId;

function Events(data) {
  let time = Date.parse(data.start.local);
  let newDate = new Date(time).toDateString();
  this.link = data.url;
  this.name = data.name.text;
  this.event_date = newDate;
  this.summary = data.summary;
}

function Movies(data){
  this.title = data.title;
  this.overview = data.overview;
  this.average_votes = data.vote_average;
  this.total_votes = data.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/original${data.poster_path}`;
  this.popularity = data.popularity;
  this.released_on = data.release_date;

}

//--------------------------------
// Location
//--------------------------------

//Static function
Location.lookup = handler => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [handler.query];

  return client.query(SQL, values)
    .then(results => {
      if(results.rowCount > 0){
        handler.cacheHit(results);
      }else{
        handler.cacheMiss(results);
      }
    })
    .catch(console.error);
};

Location.fetchLocation = (query) => {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

  return superagent.get(url)
    .then(result => {
      if(!result.body.results.length) throw 'No data';
      let location = new Location(query, result.body.results[0]);
      return location.save()
        .then(result => {
          location.id = result.rows[0].id;
          return location;
        });
    });
};

Location.prototype.save = function(){
  let SQL = `INSERT INTO locations 
    (search_query, formatted_query, latitude, longitude)
    VALUES ($1, $2, $3, $4)
    RETURNING id;`;

  let values = Object.values(this);

  return client.query(SQL, values);
};

//--------------------------------
// Weather
//--------------------------------
Weather.prototype.save = function(id){
  let SQL = `INSERT INTO weathers 
    (forecast, time, created_at, location_id)
    VALUES ($1, $2, $3, $4);`;

  let values = Object.values(this);
  values.push(id);

  return client.query(SQL, values);
};

Weather.fetch = (location) => {

  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;

  return superagent.get(url)
    .then(result => {
      const weatherSummaries = result.body.daily.data.map(day => {
        const summary = new Weather(day);
        summary.save(location.id);
        return summary;
      });
      return weatherSummaries;
    });
};

//--------------------------------
// Events
//--------------------------------
Events.tableName = 'events';
Events.lookup = lookup;

Events.prototype.save = function(id){
  let SQL = `INSERT INTO events 
    (link, name, event_date, summary, location_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id;`;

  let values = Object.values(this);
  values.push(id);

  return client.query(SQL, values);
};

Events.fetch = (location) => {
  console.log('here in event fetch');
  // console.log(request.query.data.formatted_query);
  // console.log(location);
  const url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${location.formatted_query}`;
  return superagent.get(url)
    .then(result => {
      // console.log(result.body.events.data);
      const eventSummaries = result.body.events.map(event => {
        const summary = new Events(event);
        summary.save(location.id);
        return summary;
      });
      return eventSummaries;
    });
};

//--------------------------------
// Movies
//--------------------------------

Movies.tableName = 'movies';
Movies.lookup = lookup;

Movies.prototype.save = function(id){
  let SQL = `INSERT INTO movies 
    (title, overview, average_votes, total_votes, image_url, popularity, released_on,  location_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id;`;

  let values = Object.values(this);
  values.push(id);

  return client.query(SQL, values);
};

Movies.fetch = (location) => {
  console.log('here in movies fetch');
  const url = `https://api.themoviedb.org/3/movie/now_playing?api_key=${process.env.MOVIE_API_KEY}&language=en-US&page=1`;
  return superagent.get(url)
    .then(result => {
      console.log(result.body.results[0]);
      const moviesSummaries = result.body.results.map(event => {
        const summary = new Movies(event);
        summary.save(location.id);
        return summary;
      });
      return moviesSummaries;
    });
};


//--------------------------------
// Route Callbacks
//--------------------------------

//-----------Locations
let searchCoords = (request, response) => {
  const locationHandler = {
    query: request.query.data,
    cacheHit: results => {
      console.log('Got the data Locations');
      response.send(results.rows[0]);
    },
    cacheMiss: () => {
      console.log('Fetching Locations');
      Location.fetchLocation(request.query.data)
        .then(results => response.send(results));
    }
  };
  Location.lookup(locationHandler);
};

//---------------Weather
let getWeather = (request, response) => {
  // console.log(request.query.data);
  const weatherHandler = {
    location: request.query.data,
    tableName: Weather.tableName,
    
    cacheHit: function(result){
      let ageOfResults = (Date.now() - result.rows[0].created_at);
      if(ageOfResults > timeouts.weather){
        console.log('weather cache invaild');
        Weather.deleteByLocationId(Weather.tableName, request.query.data.id);
        this.cacheMiss();
      }else{
        console.log('weather cache valid');
        response.send(result.rows);
      }
    },
    cacheMiss: () => {
      console.log('Fetching Weather');
      Weather.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);
    }
  };
  Weather.lookup(weatherHandler);
};

//---------------Events
let getEvents = (request, response) => {
  const eventHandler = {
    location: request.query.data,
    tableName: Events.tableName,
    cacheHit: results => {
      console.log('Got the data Events');
      response.send(results[0]);
    },
    cacheMiss: () => {
      console.log('Fetching Event');
      Events.fetch(request.query.data)
        .then(results => response.send(results));
    }
  };
  Events.lookup(eventHandler);
};

//---------------Movies
let getMovies = (request, response) => {
  const eventHandler = {
    location: request.query.data,
    tableName: Movies.tableName,
    cacheHit: results => {
      console.log('Got the data Movies');
      response.send(results[0]);
    },
    cacheMiss: () => {
      console.log('Fetching Movies');
      Movies.fetch(request.query.data)
        .then(results => response.send(results));
    }
  };
  Movies.lookup(eventHandler);
};

//--------------------------------
// Routes
//--------------------------------
app.get('/location', searchCoords);
app.get('/weather', getWeather);
app.get('/events', getEvents);
app.get('/movies', getMovies);


//--------------------------------
// Power On
//--------------------------------
app.listen(PORT, () => console.log(`app is listening ${PORT}`));
