// =====================================================
// Netlify Function: get-places
// Returns the number of completed Stripe payments for a given club
// within the current term date range.
//
// Environment variables required (set in Netlify dashboard):
//   STRIPE_SECRET_KEY         — Your Stripe restricted/secret key
//   TERM_START                — Term start date, e.g. "2026-04-22"
//   TERM_END                  — Term end date, e.g. "2026-07-18"
//   MAX_PLACES_BADGER_HILL    — Max places for Badger Hill (e.g. "15")
//   MAX_PLACES_POCKLINGTON    — Max places for Pocklington (e.g. "12")
//   MAX_PLACES_BEVERLEY       — Max places for Beverley breakfast club (e.g. "10")
//
// Each Stripe Payment Link must have metadata set:
//   club = "badger-hill" | "pocklington" | "beverley-breakfast"
// (Set this in Stripe Dashboard > Payment Links > Edit > Metadata)
// =====================================================

const Stripe = require('stripe');

const CLUB_MAX = {
  'badger-hill':        parseInt(process.env.MAX_PLACES_BADGER_HILL  || '0'),
  'pocklington':        parseInt(process.env.MAX_PLACES_POCKLINGTON  || '0'),
  'beverley-breakfast': parseInt(process.env.MAX_PLACES_BEVERLEY     || '0'),
};

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const club = event.queryStringParameters && event.queryStringParameters.club;

  if (!club || !CLUB_MAX[club]) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid or missing club parameter' }),
    };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ booked: 0, max: CLUB_MAX[club], configured: false }),
    };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    // Term date range
    const termStart = process.env.TERM_START
      ? Math.floor(new Date(process.env.TERM_START).getTime() / 1000)
      : Math.floor(new Date('2026-04-22').getTime() / 1000);

    const termEnd = process.env.TERM_END
      ? Math.floor(new Date(process.env.TERM_END).getTime() / 1000)
      : Math.floor(new Date('2026-07-18').getTime() / 1000);

    // Fetch completed checkout sessions for this club within the term
    // We paginate to get all results
    let booked = 0;
    let hasMore = true;
    let startingAfter = undefined;

    while (hasMore) {
      const params = {
        limit: 100,
        created: { gte: termStart, lte: termEnd },
        status: 'complete',
      };
      if (startingAfter) params.starting_after = startingAfter;

      const sessions = await stripe.checkout.sessions.list(params);

      for (const session of sessions.data) {
        // Match by metadata.club set on the Payment Link
        if (session.metadata && session.metadata.club === club) {
          booked++;
        }
      }

      hasMore = sessions.has_more;
      if (sessions.data.length > 0) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    const max = CLUB_MAX[club];
    const remaining = Math.max(0, max - booked);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        club,
        booked,
        max,
        remaining,
        configured: true,
      }),
    };

  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch booking data', details: err.message }),
    };
  }
};
