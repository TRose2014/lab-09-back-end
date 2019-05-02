'use strict';

//--------------------------------
// Load Enviroment Variables from the .env file
//--------------------------------
require('dotenv').config();

//--------------------------------g
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
app.use(cors());

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
}

function Events(data) {
  let time = Date.parse(data.start.local);
  let newDate = new Date(time).toDateString();
  this.link = data.url;
  this.name = data.name.text;
  this.event_date = newDate;
  this.summary = data.summary;
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

Weather.lookup = handler => {
  const SQL = `SELECT * FROM weathers WHERE search_query=$1;`;
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

Weather.fetchWeather = (query) => {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${query.latitude},${query.longitude}`;

  return superagent.get(url)
    .then(result => {
      if(!result.body.results.length) throw 'No data';
      let weather = new Weather(query, result.body.results[0]);
      return weather.save()
        .then(result => {
          weather.id = result.rows[0].id;
          return weather;
        });
    });
};

Weather.prototype.save = function(){
  let SQL = `INSERT INTO weathers 
    (forecast, time)
    VALUES ($1, $2)
    RETURNING id;`;

  let values = Object.values(this);

  return client.query(SQL, values);
};

//--------------------------------
// Route Callbacks
//--------------------------------
let searchCoords = (request, response) => {
  const locationHandler = {
    query: request.query.data,
    cacheHit: results => {
      console.log('Got the data');
      response.send(results[0]);
    },
    cacheMiss: () => {
      console.log('Fetching');
      Location.fetchLocation(request.query.data)
        .then(results => response.send(results));
    }
  };
  Location.lookup(locationHandler);
};


// const data = request.query.data;
// const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${data}&key=${process.env.GEOCODE_API_KEY}`;

// return superagent.get(url)
//   .then(result => {
//     response.send(new Location(data, result.body.results[0]));
//   })
//   .catch(() => errorMessage());

let searchWeather = (request, response) => {
  const weatherHandler = {
    query: request.query.data,
    cacheHit: results => {
      console.log('Got the data');
      response.send(results[0]);
    },
    cacheMiss: () => {
      console.log('Fetching');
      Weather.fetchWeather(request.query.data)
        .then(results => response.send(results));
    }
  };
  Weather.lookup(weatherHandler);
};

// const data = request.query.data;
// const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${data.latitude},${data.longitude}`;

// return superagent.get(url)
//   .then(result => {
//     const dailyWeather = result.body.daily.data.map(day => {
//       return new Weather(day);
//     });

//     response.send(dailyWeather);
//   })
//   .catch(() => errorMessage());

let searchEvents = (request, response) => {
  let url = `https://www.eventbriteapi.com/v3/events/search?token=${process.env.EVENTBRITE_API_KEY}&location.address=${request.query.data.formatted_query}`;

  return superagent.get(url)
    .then(result => {
      const eventData = result.body.events.map(event => {
        return new Events(event);
      });

      response.send(eventData);
    })
    .catch(() => errorMessage());
};

//--------------------------------
// Routes
//--------------------------------
app.get('/location', searchCoords);
app.get('/weather', searchWeather);
app.get('/events', searchEvents);


//--------------------------------
// Power On
//--------------------------------
app.listen(PORT, () => console.log(`app is listening ${PORT}`));
