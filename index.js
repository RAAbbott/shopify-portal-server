require('dotenv').config();
const express = require('express');
const app = express();
const crypto = require('crypto');
const cookie = require('cookie');
const nonce = require('nonce')();
const cors = require('cors');
const port = process.env.PORT || '3060';
const moment = require('moment');
const querystring = require('querystring');
const request = require('request-promise');
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecret = process.env.SHOPIFY_API_SECRET_KEY;
const scopes = 'read_orders,read_products,read_customers,write_orders';
const forwardingAddress = "https://eom-shopify-server.herokuapp.com"; // Replace this with your HTTPS Forwarding address (Server Address)
const clientAddress = "https://xenodochial-curie-ca34f4.netlify.app/" //Client Address
const Shopify = require('shopify-api-node');
let shopify;

// Express Methods

const bodyParser = require('body-parser');
const corsOptions = {
    origin: 'http://localhost:3000',
    methods: "POST,GET,OPTIONS",
    allowedHeaders: "Content-Type,Content-Length, Authorization, Accept,X-Requested-With",
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
  }

app.use(bodyParser.json());
app.use(cors(corsOptions));

app.use(bodyParser.urlencoded({
   extended: true
}));

app.listen(port, () => {
    console.log('Listening on port', port);
});

// Shopify Routes

app.get('/shopify', (req, res) => {

    const shop = req.query.shop;
    if (shop) {
      const state = nonce();
      const redirectUri = forwardingAddress + '/shopify/callback';
      const installUrl = 'https://' + shop +
        '/admin/oauth/authorize?client_id=' + apiKey +
        '&scope=' + scopes +
        '&state=' + state +
        '&redirect_uri=' + redirectUri;
  
      res.cookie('state', state);
      res.redirect(installUrl);
    } else {
      return res.status(400).send('Missing shop parameter. Please add ?shop=your-development-shop.myshopify.com to your request');
    }
  });

  app.get('/shopify/callback', (req, res) => {
    const { shop, hmac, code, state } = req.query;
    const stateCookie = cookie.parse(req.headers.cookie).state;
  
    if (state !== stateCookie) {
      return res.status(403).send('Request origin cannot be verified');
    }
  
    if (shop && hmac && code) {
      // DONE: Validate request is from Shopify
      const map = Object.assign({}, req.query);
      delete map['signature'];
      delete map['hmac'];
      const message = querystring.stringify(map);
      const providedHmac = Buffer.from(hmac, 'utf-8');
      const generatedHash = Buffer.from(
        crypto
          .createHmac('sha256', apiSecret)
          .update(message)
          .digest('hex'),
          'utf-8'
        );
      let hashEquals = false;
  
      try {
        hashEquals = crypto.timingSafeEqual(generatedHash, providedHmac)
      } catch (e) {
        hashEquals = false;
      };
  
      if (!hashEquals) {
        return res.status(400).send('HMAC validation failed');
      }
  
      // DONE: Exchange temporary code for a permanent access token
      const accessTokenRequestUrl = 'https://' + shop + '/admin/oauth/access_token';
      const accessTokenPayload = {
        client_id: apiKey,
        client_secret: apiSecret,
        code,
      };
  
      request.post(accessTokenRequestUrl, { json: accessTokenPayload })
      .then(async (accessTokenResponse) => {
        const accessToken = accessTokenResponse.access_token;
        // DONE: Use access token to make API call to 'shop' endpoint
        shopify = new Shopify({
            shopName: shop,
            accessToken
        });
        res.redirect('/');
      })
      .catch((error) => {
        res.status(error.statusCode).send(error.error.error_description);
      });
  
    } else {
      res.status(400).send('Required parameters missing');
    }
  });

app.get('/orders', async (req, res) => {
  shopify = new Shopify({
    shopName: process.env.SHOP_NAME,
    apiKey: process.env.API_KEY,
    password: process.env.PASSWORD
  });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE'); // If needed
  // res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,contenttype'); // If needed
  // res.setHeader('Access-Control-Allow-Credentials', true); // If needed
  res.json(await formatOrders());
});

app.get('/', (req, res) => {
    res.redirect(clientAddress);
})

app.post('/completeOrders', async (req, res) => {
  const tag = 'EOM-READY';
  const orders = req.body.orderIds;
  let error = false;
  const asyncForEach = async (array, callback) => {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array);
    }
  }
  const updateTags = async () => {
    await asyncForEach(orders, async (orderId) => {
      try {
        await shopify.order.update(orderId, {tags: 'EOM-READY'});
        console.log('success');
      } catch (error) {
        console.log(error);
        error = true;
      }
    })
  }

  if (!shopify) {
    shopify = new Shopify({
      shopName: process.env.SHOP_NAME,
      apiKey: process.env.API_KEY,
      password: process.env.PASSWORD
    })
  }

  await updateTags();

  if (error) {
    res.status(500).send("Error When Updating Orders, Please Try Again");
  } else {
    res.status(200).send("All Orders Successfully Updated");
  }
  
})

// Helper Methods

async function getOrders() {
    if (shopify) {
        return await shopify.order.list({limit: 150, status: 'open', fulfillment: 'open'}).then(orders => orders).catch(err => err);
    }
  }

  async function formatOrders() {
    const orderList = [];
    const productList = [];
    const orders = await getOrders();

    Array.isArray(orders) && orders.length && orders.forEach(order => {
      const productIds = [];
      order.line_items.forEach(product => {
        const variants = product.variant_title.split(' / ');
        const productProperties = {
          id: product.id,
          orderId: order.id,
          productName: product.title,
          option1: 'Size',
          option2: 'Color',
          variant1: variants.length >= 1 ? variants[0] : '',
          variant2: variants.length >= 2 ? variants[1] : '',
          productProperties: product.properties,
          custom: product.properties.length ? product.properties[0].value : '-',
          completed: false,
        };

        for (let i = 0; i < product.quantity; i++) {
          // Takes care of duplicate quantities in same order. Items end up having the same exact ID, this fixes it
          if (productIds.find(id => id === productProperties.id)) {
            productProperties.id = parseInt(`${productProperties.id}${Math.floor(Math.random() * 1000000)}`, 10);
          }

          productList.push(Object.assign({}, productProperties));
          productIds.push(productProperties.id);
        }
      });

      orderList.push({
        id: order.id,
        customerName: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'CUSTOMER NOT FOUND',
        customerEmail: order.email || 'CUSTOMER NOT FOUND',
        amount: order.total_price,
        note: order.note,
        dateOrdered: moment(order.created_at).format('MMM DD'),
        products: productIds,
        completed: false,
        marked: false,
        tags: order.tags
      })
    });


    return {orderList, productList};

  }