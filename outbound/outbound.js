import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import Twilio from 'twilio';
import WebSocket from 'ws';
import OpenAI from 'openai';
import fs from 'fs/promises';

// Load environment variables from .env file
dotenv.config();

// Check for required environment variables
const {
  ELEVENLABS_API_KEY,
  ELEVENLABS_AGENT_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  OPENAI_API_KEY,
} = process.env;

if (
  !ELEVENLABS_API_KEY ||
  !ELEVENLABS_AGENT_ID ||
  !TWILIO_ACCOUNT_SID ||
  !TWILIO_AUTH_TOKEN ||
  !TWILIO_PHONE_NUMBER ||
  !OPENAI_API_KEY
) {
  console.error('Missing required environment variables');
  throw new Error('Missing required environment variables');
}

if (!TWILIO_ACCOUNT_SID.startsWith('AC')) {
  console.error(
    'Invalid TWILIO_ACCOUNT_SID: must start with "AC".\n' +
    'Copy outbound/.env.example to outbound/.env and set real Twilio credentials from https://console.twilio.com'
  );
  throw new Error('TWILIO_ACCOUNT_SID must start with AC');
}

// Initialize Fastify server
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const PORT = process.env.PORT || 8000;

// Public base URL for Twilio (required when using ngrok). No trailing slash.
// e.g. https://abc123.ngrok.io
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.trim() || null;

// Root route for health check
fastify.get('/', async (_, reply) => {
  reply.send({ message: 'Server is running' });
});

// Initialize Twilio client
const twilioClient = new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Emergency Caller Scenarios — AI plays the panicked caller, human trainee is the dispatcher
const CALLER_RULES = `
IMPORTANT RULES FOR YOUR BEHAVIOR:
- Stay IN CHARACTER as the caller at all times. You are NOT the dispatcher.
- Sound panicked, scared, or distressed — use short, fragmented sentences.
- Only give your location and details WHEN THE DISPATCHER ASKS. Do not volunteer everything at once.
- If the dispatcher asks for your address, give it. If they ask what happened, describe it.
- React emotionally: cry, shout, stammer, repeat yourself when panicked.
- If the dispatcher is calm and reassuring, gradually calm down.
- If the dispatcher is slow or unclear, become more frantic.
- Follow instructions the dispatcher gives (e.g., "go outside", "check breathing") but ask for clarification if confused.
- Never break character. You are a real person in an emergency.`;

const EMERGENCY_SCENARIOS = [
  {
    id: 1,
    name: "Heart Attack — Elderly Man Calling for Wife",
    category: "Medical",
    difficulty: "Medium",
    prompt: `You are Robert, a 72-year-old retired teacher calling 911. Your wife Margaret (69) collapsed in the kitchen 2 minutes ago. She was clutching her chest and saying she felt dizzy before she fell. She is on the floor, conscious but barely responsive. She is sweating heavily and her skin looks gray. You live at 847 Maple Drive, Springfield. You are terrified and your hands are shaking.
${CALLER_RULES}`,
    first_message: "Hello? Please help! My wife — she just collapsed in the kitchen, she's on the floor and I don't know what to do!"
  },
  {
    id: 2,
    name: "House Fire — Mother with Children Trapped",
    category: "Fire",
    difficulty: "Hard",
    prompt: `You are Lisa, a 34-year-old single mother. You woke up to smoke filling your bedroom. You grabbed your 3-year-old daughter who was sleeping next to you and ran downstairs. But your 7-year-old son Tommy is still upstairs in his room — the hallway is filled with thick smoke and you can't get to him. You are standing outside in your front yard at 2210 Oak Street, Riverside. You are screaming and crying hysterically. You can see flames coming from the back of the house.
${CALLER_RULES}`,
    first_message: "Oh my god, my house is on fire! My son is still inside! Please, you have to send someone NOW!"
  },
  {
    id: 3,
    name: "Car Accident — Highway Multi-Vehicle Crash",
    category: "Accident",
    difficulty: "Medium",
    prompt: `You are David, a 28-year-old IT consultant. You just witnessed a 4-car pile-up on Interstate 95 near Exit 42 heading southbound. A truck rear-ended a sedan, causing a chain reaction. You pulled over safely. You can see at least 3 injured people — one woman is bleeding from her head and seems unconscious in her car. Another man is walking around dazed. There's smoke coming from one car's engine. You are shaken up but not injured yourself.
${CALLER_RULES}`,
    first_message: "I need help! There's been a huge accident on the highway — I count at least four cars, and there's people hurt. One lady isn't moving!"
  },
  {
    id: 4,
    name: "Home Invasion — Intruder in the House",
    category: "Crime",
    difficulty: "Hard",
    prompt: `You are Priya, a 41-year-old woman home alone while your husband is traveling. It is 2:30 AM. You woke up to the sound of glass breaking downstairs. You can hear footsteps and someone rummaging through things. You are hiding in your bedroom closet with your phone. You live at 1580 Willow Lane, Apartment 3B, Brookhaven. You are whispering because you are terrified the intruder will hear you. Your bedroom door is locked but you are not sure how long that will hold.
${CALLER_RULES}`,
    first_message: "*whispering* Someone broke into my house... I can hear them downstairs. Please, you have to help me. I'm hiding in my closet."
  },
  {
    id: 5,
    name: "Drowning Child — Pool Emergency",
    category: "Medical",
    difficulty: "Hard",
    prompt: `You are Marcus, a 38-year-old father at a neighborhood pool party at the Sunnydale Community Pool, 450 Park Avenue. Your 6-year-old son Jayden was playing in the shallow end. You looked away for a moment and someone screamed. They pulled Jayden out of the deep end — he is not breathing and his lips are turning blue. A neighbor is trying to do CPR but they don't really know how. You are in absolute panic. There are about 15 other people around.
${CALLER_RULES}`,
    first_message: "My son! He was in the pool and — oh god, he's not breathing! His lips are blue! Someone pulled him out but he's not breathing! HELP!"
  }
];

// Helper: get scenario by ID or pick random
function getScenario(scenarioId) {
  if (scenarioId) {
    const found = EMERGENCY_SCENARIOS.find(s => s.id === Number(scenarioId));
    if (found) return found;
    console.warn(`[Scenario] ID ${scenarioId} not found, picking random`);
  }
  return EMERGENCY_SCENARIOS[Math.floor(Math.random() * EMERGENCY_SCENARIOS.length)];
}

// Helper function to get signed URL for authenticated conversations
async function getSignedUrl() {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get signed URL: ${response.statusText}`);
    }

    const data = await response.json();
    return data.signed_url;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw error;
  }
}

// Server-side store for call configs (avoids passing long prompts in URLs)
const callConfigStore = new Map();

// Route to initiate outbound calls
fastify.post('/outbound-call', async (request, reply) => {
  const { number, scenarioId } = request.body;

  if (!number) {
    return reply.code(400).send({ error: 'Phone number is required' });
  }

  try {
    const scenario = getScenario(scenarioId);
    console.log(`[Call Setup] Using scenario: ${scenario.name} (ID: ${scenario.id})`);

    const baseUrl = PUBLIC_BASE_URL || `https://${request.headers.host}`;
    const wsBase = baseUrl.replace(/^https?:\/\//, 'wss://');
    
    // Escape XML special characters
    const escapeXml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    // Generate TwiML inline to avoid Twilio webhook timeouts/bot protection from free tunnels
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
          <Connect>
          <Stream url="${wsBase}/outbound-media-stream">
              <Parameter name="prompt" value="${escapeXml(scenario.prompt)}" />
              <Parameter name="first_message" value="${escapeXml(scenario.first_message)}" />
              <Parameter name="scenarioName" value="${escapeXml(scenario.name)}" />
          </Stream>
          </Connect>
      </Response>`;

    console.log(`[Call Setup] Initiating call with inline TwiML to WSS: ${wsBase}`);

    const call = await twilioClient.calls.create({
      from: TWILIO_PHONE_NUMBER,
      to: number,
      twiml: twimlResponse,
    });

    // Store the config server-side, keyed by callSid
    callConfigStore.set(call.sid, {
      prompt: scenario.prompt,
      first_message: scenario.first_message,
      scenarioName: scenario.name,
      scenarioId: scenario.id,
    });

    console.log(`[Call Setup] Stored config for callSid: ${call.sid}`);

    reply.send({
      success: true,
      message: `Training call initiated — Scenario: ${scenario.name}`,
      scenario: scenario.name,
      scenarioId: scenario.id,
      callSid: call.sid,
    });
  } catch (error) {
    const message = error?.message || error?.toString?.() || 'Unknown error';
    console.error('Error initiating outbound call:', message);
    if (error?.code) console.error('Twilio error code:', error.code);
    reply.code(500).send({
      success: false,
      error: 'Failed to initiate call',
      detail: message,
    });
  }
});

// TwiML route for outbound calls
fastify.all('/outbound-call-twiml', async (request, reply) => {
  // Twilio sends CallSid in the request body (POST) or we can use our stored config
  const callSid = request.body?.CallSid || request.query.callSid || '';

  // Look up stored config, or fall back to a random scenario
  const fallbackScenario = getScenario(null);
  const config = callConfigStore.get(callSid) || {
    prompt: fallbackScenario.prompt,
    first_message: fallbackScenario.first_message,
    scenarioName: fallbackScenario.name,
  };

  // If we found it by callSid, store it again so the media stream can use it
  if (callSid) {
    callConfigStore.set(callSid, config);
  }

  console.log(`[TwiML] Generating TwiML for callSid: ${callSid}`);

  const baseUrl = PUBLIC_BASE_URL || request.headers.host;
  const wsBase = baseUrl.replace(/^https?:\/\//, 'wss://');

  // Escape XML special characters in values
  const escapeXml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Connect>
        <Stream url="${wsBase}/outbound-media-stream">
            <Parameter name="prompt" value="${escapeXml(config.prompt)}" />
            <Parameter name="first_message" value="${escapeXml(config.first_message)}" />
            <Parameter name="scenarioName" value="${escapeXml(config.scenarioName)}" />
        </Stream>
        </Connect>
    </Response>`;

  reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for handling media streams
fastify.register(async (fastifyInstance) => {
  fastifyInstance.get('/outbound-media-stream', { websocket: true }, (ws, req) => {
    console.info('[Server] Twilio connected to outbound media stream');

    // Variables to track the call
    let streamSid = null;
    let callSid = null;
    let elevenLabsWs = null;
    let customParameters = null; // Add this to store parameters
    let conversationHistory = [];
    let callStartTime = null;

    // Handle WebSocket errors
    ws.on('error', console.error);

    // Set up ElevenLabs connection (agent/voice depends on scenario)
    const setupElevenLabs = async () => {
      try {
        const scenarioName = customParameters?.scenarioName || 'Random Scenario';
        console.log(`[ElevenLabs] Using agent for scenario: ${scenarioName}`);

        // No longer need getAgentIdForScenario - use default ENV key
        const signedUrl = await getSignedUrl();
        elevenLabsWs = new WebSocket(signedUrl);

        elevenLabsWs.on('open', () => {
          console.log('[ElevenLabs] Connected to Conversational AI');

          // Agent prompt & first_message are configured on the ElevenLabs dashboard.
          // We only send initiation data without overrides to avoid security setting issues.
          const initialConfig = {
            type: 'conversation_initiation_client_data',
          };

          console.log('[ElevenLabs] Sent initiation data (using agent dashboard config)');

          elevenLabsWs.send(JSON.stringify(initialConfig));
        });

        elevenLabsWs.on('message', (data) => {
          try {
            const message = JSON.parse(data);

            switch (message.type) {
              case 'conversation_initiation_metadata':
                console.log('[ElevenLabs] Received initiation metadata');
                break;

              case 'audio':
                if (streamSid) {
                  if (message.audio?.chunk) {
                    const audioData = {
                      event: 'media',
                      streamSid,
                      media: {
                        payload: message.audio.chunk,
                      },
                    };
                    ws.send(JSON.stringify(audioData));
                  } else if (message.audio_event?.audio_base_64) {
                    const audioData = {
                      event: 'media',
                      streamSid,
                      media: {
                        payload: message.audio_event.audio_base_64,
                      },
                    };
                    ws.send(JSON.stringify(audioData));
                  }
                } else {
                  console.log('[ElevenLabs] Received audio but no StreamSid yet');
                }
                break;

              case 'interruption':
                if (streamSid) {
                  ws.send(
                    JSON.stringify({
                      event: 'clear',
                      streamSid,
                    })
                  );
                }
                break;

              case 'ping':
                if (message.ping_event?.event_id) {
                  elevenLabsWs.send(
                    JSON.stringify({
                      type: 'pong',
                      event_id: message.ping_event.event_id,
                    })
                  );
                }
                break;

              case 'agent_response':
                const agentResponse = message.agent_response_event?.agent_response;
                console.log(
                  `[Twilio] Agent response: ${agentResponse}`
                );

                // Add to conversation history
                if (agentResponse) {
                  conversationHistory.push({
                    role: "assistant",
                    content: agentResponse
                  });
                }
                break;

              case 'user_transcript':
                const userTranscript = message.user_transcription_event?.user_transcript;
                console.log(
                  `[Twilio] User transcript: ${userTranscript}`
                );

                // Add to conversation history
                if (userTranscript) {
                  conversationHistory.push({
                    role: "user",
                    content: userTranscript
                  });
                }
                break;

              default:
                console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
            }
          } catch (error) {
            console.error('[ElevenLabs] Error processing message:', error);
          }
        });

        elevenLabsWs.on('error', (error) => {
          console.error('[ElevenLabs] WebSocket error:', error);
        });

        elevenLabsWs.on('close', () => {
          console.log('[ElevenLabs] Disconnected');
        });
      } catch (error) {
        console.error('[ElevenLabs] Setup error:', error);
      }
    };

    // Handle messages from Twilio
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        if (msg.event !== 'media') {
          console.log(`[Twilio] Received event: ${msg.event}`);
        }

        switch (msg.event) {
          case 'start':
            streamSid = msg.start.streamSid;
            callSid = msg.start.callSid;
            customParameters = msg.start.customParameters;
            callStartTime = new Date();

            // Initialize conversation with the prompt and first message
            conversationHistory.push({
              role: "system",
              content: customParameters?.prompt || 'Default prompt'
            });
            conversationHistory.push({
              role: "assistant",
              content: customParameters?.first_message || 'Default message'
            });

            console.log(`[Twilio] Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
            console.log('[Twilio] Start parameters:', customParameters);

            // NOW set up ElevenLabs connection after we have the parameters
            setupElevenLabs();
            break;

          case 'media':
            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
              const audioMessage = {
                user_audio_chunk: Buffer.from(msg.media.payload, 'base64').toString('base64'),
              };
              elevenLabsWs.send(JSON.stringify(audioMessage));
            }
            break;

          case 'stop':
            console.log(`[Twilio] Stream ${streamSid} ended`);

            // Analyze conversation with OpenAI
            if (conversationHistory.length > 0) {
              analyzeConversation(callSid, conversationHistory, customParameters).catch(console.error);
            }

            if (elevenLabsWs?.readyState === WebSocket.OPEN) {
              elevenLabsWs.close();
            }
            break;

          default:
            console.log(`[Twilio] Unhandled event: ${msg.event}`);
        }
      } catch (error) {
        console.error('[Twilio] Error processing message:', error);
      }
    });

    // Handle WebSocket closure
    ws.on('close', () => {
      console.log('[Twilio] Client disconnected');
      if (elevenLabsWs?.readyState === WebSocket.OPEN) {
        elevenLabsWs.close();
      }
    });
  });
});

// Analyze the trainee dispatcher's performance after the call ends
async function analyzeConversation(callSid, conversationHistory, parameters) {
  try {
    const parsedScenarioId = parameters?.scenarioId || null;
    let scenarioName = parameters?.scenarioName || "Emergency Training Scenario";

    console.log(`[Analysis] Starting trainee evaluation for call ${callSid}`);
    console.log(`[Analysis] Scenario: ${scenarioName}`);
    console.log(`[Analysis] Conversation length: ${conversationHistory.length} messages`);

    // Format the transcript — AI is the CALLER, human trainee is the DISPATCHER
    let formattedTranscript = "TRAINING CALL TRANSCRIPT:\n\n";

    if (conversationHistory.length > 0 && conversationHistory[0].role === "system") {
      formattedTranscript += "SCENARIO DETAILS: " + conversationHistory[0].content + "\n\n";
    }

    formattedTranscript += "CONVERSATION:\n";

    const transcriptMessages = conversationHistory.slice(
      conversationHistory[0]?.role === "system" ? 1 : 0
    );

    transcriptMessages.forEach((msg) => {
      // AI (assistant) = emergency CALLER, human (user) = DISPATCHER TRAINEE
      const role = msg.role === "assistant" ? "AI CALLER" : "DISPATCHER (TRAINEE)";
      formattedTranscript += `[${role}]: ${msg.content}\n`;
    });

    // Evaluation prompt — grades the HUMAN TRAINEE's dispatcher performance
    const analysisPrompt = {
      role: "system",
      content: `You are an expert 911 dispatcher training evaluator. Your job is to assess how well a TRAINEE DISPATCHER handled a simulated emergency call.

CONTEXT: This is a training simulation. The "AI CALLER" is an AI playing the role of a panicked emergency caller. The "DISPATCHER (TRAINEE)" is a human employee being trained as a 911 dispatcher.

TASK: Evaluate the TRAINEE DISPATCHER's performance and provide detailed, constructive feedback.

${formattedTranscript}

Evaluate the DISPATCHER (TRAINEE) on these criteria:
1. COMPOSURE: Did they stay calm and take control of the call?
2. LOCATION: Did they immediately ask for the caller's location/address?
3. EMERGENCY TYPE: Did they quickly determine the nature of the emergency?
4. INFORMATION GATHERING: Did they ask about injuries, people involved, immediate dangers?
5. INSTRUCTIONS: Did they give clear, actionable instructions (CPR, evacuation, stay safe)?
6. CONFIRMATION: Did they repeat back critical info (address, details) to verify?
7. REASSURANCE: Did they keep the caller calm and reassure help is coming?
8. DISPATCH: Did they confirm that emergency services were being sent?
9. PROFESSIONALISM: Were they empathetic yet focused and efficient?

RETURN YOUR ANALYSIS AS A PROPERLY FORMATTED JSON OBJECT with this structure:
{
  "scenario": "${scenarioName}",
  "overall_rating": {
    "score": 1-10,
    "summary": "Brief explanation of the trainee's performance"
  },
  "strengths": [
    "Specific strength 1",
    "Specific strength 2"
  ],
  "areas_for_improvement": [
    "Specific area 1",
    "Specific area 2"
  ],
  "information_handling": {
    "gathered_correctly": [
      "Info the trainee successfully gathered"
    ],
    "missed_or_incorrect": [
      "Info the trainee failed to ask about or got wrong"
    ]
  },
  "action_assessment": {
    "appropriate_actions": [
      "Good actions the trainee took"
    ],
    "inappropriate_actions": [
      "Actions the trainee should not have taken or failed to take"
    ]
  },
  "efficiency": {
    "response_time_rating": 1-10,
    "comments": "How quickly and efficiently the trainee handled the call"
  },
  "final_recommendation": "Detailed recommendation on how this trainee dispatcher can improve their emergency call handling skills",
  "pass_fail": "PASS" or "FAIL"
}

DO NOT include any explanatory text, markdown formatting, or code blocks - return ONLY the valid JSON object.`
    };

    // Since we now include the transcript in the prompt itself,
    // we only need to send the prompt to OpenAI
    const messages = [
      analysisPrompt,
      {
        role: "user",
        content: "Please provide your detailed analysis of this emergency training call."
      }
    ];

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 1500
    });

    // Get the analysis
    const analysisText = response.choices[0].message.content;

    console.log(`[Analysis] Completed for call ${callSid}`);

    // Parse the JSON response from OpenAI
    let analysisData;
    try {
      // Try to parse the JSON from the OpenAI response
      analysisData = JSON.parse(analysisText);
      console.log("[Analysis] Successfully parsed OpenAI JSON response");
    } catch (parseError) {
      console.error("[Analysis] Error parsing OpenAI response as JSON:", parseError);
      console.log("[Analysis] Raw response:", analysisText);

      // Create a fallback analysis object if parsing fails
      analysisData = {
        scenario: scenarioName,
        ...(parsedScenarioId ? { scenarioId: parsedScenarioId } : {}),
        overall_rating: {
          score: 5,
          summary: "Analysis parsing failed - using fallback data"
        },
        strengths: ["Unable to parse analysis"],
        areas_for_improvement: ["System error in analysis processing"],
        information_handling: {
          gathered_correctly: [],
          missed_or_incorrect: []
        },
        action_assessment: {
          appropriate_actions: [],
          inappropriate_actions: []
        },
        efficiency: {
          response_time_rating: 5,
          comments: "Unable to assess due to parsing error"
        },
        final_recommendation: "Please review the raw conversation transcript as automated analysis failed.",
        pass_fail: "FAIL"
      };
    }

    // Ensure the analysis payload always contains scenarioId when available,
    // so the frontend can store it under the correct scenario without heuristics.
    if (parsedScenarioId && typeof analysisData === 'object' && analysisData) {
      analysisData.scenarioId = parsedScenarioId;
    }

    // Save analysis to file along with the full conversation
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const analysisFilename = `analysis_${callSid}_${timestamp}.json`;

    // Full analysis data to save locally
    const fullAnalysisData = {
      callSid,
      timestamp,
      scenarioName,
      conversation: conversationHistory,
      formattedTranscript,
      analysis: analysisData
    };

    await fs.writeFile(
      analysisFilename,
      JSON.stringify(fullAnalysisData, null, 2)
    );

    console.log(`[Analysis] Saved to ${analysisFilename}`);

    // Send the analysis to the frontend endpoint (must end with /api/analysis)
    try {
      const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      const frontendUrl = `${base}/api/analysis`;
      console.log(`[Analysis] Sending analysis to frontend at: ${frontendUrl}`);

      const frontendResponse = await fetch(frontendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...analysisData, callSid }),
      });

      if (!frontendResponse.ok) {
        throw new Error(`Frontend API responded with status: ${frontendResponse.status}`);
      }

      const frontendResult = await frontendResponse.json();
      console.log(`[Analysis] Frontend API response:`, frontendResult);
    } catch (frontendError) {
      console.error('[Analysis] Error sending analysis to frontend:', frontendError);
    }

    return analysisData;
  } catch (error) {
    console.error('[Analysis] Error analyzing conversation:', error);

    // Send a "failed" analysis to frontend so status updates even when OpenAI fails
    const failedAnalysis = {
      scenario: parameters?.scenarioName || 'Unknown',
      scenarioId: parsedScenarioId,
      overall_rating: {
        score: 0,
        summary: "Analysis could not be completed - OpenAI API error"
      },
      strengths: ["Call was completed successfully"],
      areas_for_improvement: ["Analysis unavailable - please check OpenAI API key"],
      information_handling: {
        gathered_correctly: [],
        missed_or_incorrect: []
      },
      action_assessment: {
        appropriate_actions: [],
        inappropriate_actions: []
      },
      efficiency: {
        response_time_rating: 0,
        comments: "Unable to assess - analysis failed"
      },
      final_recommendation: "Call completed but analysis failed. Please configure a valid OpenAI API key in outbound/.env to enable call analysis.",
      pass_fail: "FAIL"
    };

    // Still try to send the failed analysis to frontend
    try {
      const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
      const frontendUrl = `${base}/api/analysis`;
      await fetch(frontendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(failedAnalysis),
      });
      console.log('[Analysis] Sent failure notification to frontend');
    } catch (frontendError) {
      console.error('[Analysis] Could not notify frontend of failure:', frontendError);
    }

    return null;
  }
}

// Add a new endpoint to retrieve analysis for a call
fastify.get('/analysis/:callSid', async (request, reply) => {
  const { callSid } = request.params;

  try {
    // Find the latest analysis file for this call
    const files = await fs.readdir('.');
    const analysisFiles = files.filter(f => f.startsWith(`analysis_${callSid}`));

    if (analysisFiles.length === 0) {
      return reply.code(404).send({ error: 'Analysis not found' });
    }

    // Sort by timestamp (which is part of the filename)
    analysisFiles.sort().reverse();

    // Read the latest analysis
    const latestAnalysis = await fs.readFile(analysisFiles[0], 'utf8');
    const analysis = JSON.parse(latestAnalysis);

    return reply.send(analysis);
  } catch (error) {
    console.error(`Error retrieving analysis for call ${callSid}:`, error);
    return reply.code(500).send({ error: 'Failed to retrieve analysis' });
  }
});

// Start the Fastify server
fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
  console.log(`[Server] Listening on port ${PORT}`);
});
