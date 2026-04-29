import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

// Store analyses persistently in a JSON file
const ANALYSIS_FILE = path.join(process.cwd(), 'analysis_data.json');

// Initialize with empty data if file doesn't exist
async function getStoredAnalyses() {
  try {
    const data = await fs.readFile(ANALYSIS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    // Return empty object if file doesn't exist or has invalid JSON
    return {};
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    // Log the received data for debugging
    console.log('Received analysis data:', JSON.stringify(data).slice(0, 200));

    // Use callSid as primary key for storage (works for all scenarios)
    const callSid = data.callSid;

    // Also try to extract scenarioId for backward compatibility
    let scenarioId = data.scenarioId;
    if (!scenarioId) {
      const scenarioName = data.scenario || '';
      if (scenarioName.includes('John Smith')) {
        scenarioId = 1;
      } else if (scenarioName.includes('Sarah Johnson')) {
        scenarioId = 2;
      } else if (scenarioName.includes('Michael Chen')) {
        scenarioId = 3;
      }
    }

    if (!callSid && !scenarioId) {
      return NextResponse.json(
        { error: 'Could not identify call (no callSid or scenarioId)' },
        { status: 400 }
      );
    }

    // Store the analysis
    const analyses = await getStoredAnalyses();
    const analysisEntry = {
      ...data,
      receivedAt: new Date().toISOString()
    };

    // Store by callSid (primary) 
    if (callSid) {
      analyses[callSid] = analysisEntry;
    }
    // Also store by scenarioId for backward compatibility
    if (scenarioId) {
      analyses[scenarioId] = analysisEntry;
    }

    // Save updated analyses
    await fs.writeFile(ANALYSIS_FILE, JSON.stringify(analyses, null, 2));

    console.log(`Stored analysis - callSid: ${callSid}, scenarioId: ${scenarioId}`);

    return NextResponse.json({
      success: true,
      message: 'Analysis received and stored successfully',
      callSid,
      scenarioId,
      status: data.pass_fail
    });
  } catch (error) {
    console.error('Error processing analysis:', error);
    return NextResponse.json(
      { error: 'Failed to process analysis data' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const callSid = searchParams.get('callSid');
  const scenarioId = searchParams.get('id');

  const lookupKey = callSid || scenarioId;

  if (!lookupKey) {
    return NextResponse.json(
      { error: 'callSid or id parameter is required' },
      { status: 400 }
    );
  }

  try {
    const analyses = await getStoredAnalyses();
    const result = analyses[lookupKey];

    if (!result) {
      return NextResponse.json(
        { error: 'No analysis found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error retrieving analysis for ${lookupKey}:`, error);
    return NextResponse.json(
      { error: 'Failed to retrieve analysis' },
      { status: 500 }
    );
  }
}