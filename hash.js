const bcrypt = require("bcrypt");

bcrypt.hash("Colt45!!!", 10)
  .then(hash => console.log(hash))
  .catch(err => console.error(err));