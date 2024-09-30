const axios = require('axios');

// test call to axios fetch google.com
axios
  .get('http://www.google.com')
  .then(function (response) {
    console.log('OK');
  })
  .catch(function (error) {
    console.log('ERROR');
  });
