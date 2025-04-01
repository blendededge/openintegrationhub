# Session Auth

## Auth Clients
Creating an Auth Client does not in itself create a secret or credentials. A Session Auth client is like a recipe for creating the secret. You will suplly the information needed to generate the secret, without providing any sensitive information.

### Fields

Include: Basic Secret Fields

#### `tokenPath`
The path to the access token in the JSON response from the token endpoint.

The code to extract the token is:
```js
const parsePath = (object, keys) => keys.split('.').reduce((o, k) => (o || {})[k], object);
```

This *can* handle array access. Here are some examples:
```js
const data = {
    users: [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 }
    ]
  };
  
  console.log(parsePath(data, "users.0.name")); // "Alice"
  console.log(parsePath(data, "users.1.age"));  // 25
  console.log(parsePath(data, "users.2.name")); // undefined (out of bounds)
```

#### `expirationPath`
The path to the expiration time in the JSON response from the token endpoint.




