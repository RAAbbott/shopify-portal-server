require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const port = process.env.PORT || '3060';
const moment = require('moment');
const Shopify = require('shopify-api-node');
const shopify  = new Shopify({
    shopName: process.env.SHOP_NAME,
    apiKey: process.env.API_KEY,
    password: process.env.PASSWORD
});


// Express Methods

const bodyParser = require('body-parser');
const corsOptions = {
    origin: 'http://localhost:3000.com',
    optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
  }

app.use(bodyParser.json());
app.use(cors(corsOptions));

app.use(bodyParser.urlencoded({
   extended: true
}));

app.listen(port, () => {
    console.log('Listening on port', port);
})

app.get('/orders', async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE'); // If needed
    // res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,contenttype'); // If needed
    // res.setHeader('Access-Control-Allow-Credentials', true); // If needed
    res.json(await formatOrders());
});


// Helper Methods

async function getOrders() {
    return await shopify.order.list({limit: 100, status: 'open', fulfillment_status: 'open'}).then(orders => orders).catch(err => err);
}

async function formatOrders() {
    const orderList = [];
    // const productList = [];
    const orders = await getOrders();

    orders.forEach(order => {
        const productIds = [];
        const productList = [];
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
                productList.push(productProperties);
            }
            // productIds.push(product.id);
        });
        
        orderList.push({
            id: order.id,
            customerName: `${order.customer.first_name} ${order.customer.last_name}`,
            customerEmail: order.email,
            amount: order.total_price,
            note: order.note,
            dateOrdered: moment(order.created_at).format('MMM DD'),
            products: productList
        })
    });

    return orderList;

}