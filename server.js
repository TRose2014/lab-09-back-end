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
// Route Callbacks
//--------------------------------
let searchCoords = (request, response) => {
  const data = request.query.data;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${data}&key=${process.env.GEOCODE_API_KEY}`;

  return superagent.get(url)
    .then(result => {
      response.send(new Location(data, result.body.results[0]));
    })
    .catch(() => errorMessage());
};

let searchWeather = (request, response) => {
  const data = request.query.data;
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${data.latitude},${data.longitude}`;

  return superagent.get(url)
    .then(result => {
      const dailyWeather = result.body.daily.data.map(day => {
        return new Weather(day);
      });

      response.send(dailyWeather);
    })
    .catch(() => errorMessage());
};

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