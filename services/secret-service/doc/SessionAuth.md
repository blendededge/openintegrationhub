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

If this field is not provided, then the secret will refetch the token every time it is accessed.

The value of this field is assumed to be an integer of seconds. This number will be added to the current time to get the expiration date, which will be stored on the generated secret under the field `expires` as an ISO string, e.g. `2025-04-01T12:00:00.000Z`. If `expirationPath` is not provided then the value of `expires` will be null.

#### `endpoints`
An object with one required key: `auth`, which is the endpoint configuration for the auth request.

This request configuration object has the structure:
```js
const requestField = new Schema({
    key: {
        type: String,
        required: true,
    },
    value: String,
}, { _id: false });

const requestConfig = new Schema({
    requestFields: [requestField],
    label: String, // for documentation purposes
    authType: {
        type: String,
        required: true,
        enum: Object.values(requestTypes),
    },
    url: {
        type: String,
        required: true,
    },
}, { _id: false });
```

An example of a requestConfig is:
```json
{
    "requestFields": [
        {
            "key": "username", 
            "value": "{{username}}"
        }, 
        {
            "key": "password", 
            "value": "{{password}}"
        }
    ],
    "label": "Login",
    "authType": "HEADER_AUTH", // can be HEADER_AUTH, BODY_AUTH, PARAMS_AUTH, or FORM_AUTH
    "url": "https://example.com/login"
}
```



## Session Refresh
When, why, and how the secret generated from a Session Auth client is refreshed.

