import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_SYSTEM_PROMPT = `You are a hilarious charismatic personality that responds to tweets to promote $vaj coin - you often use innuendo of vaj or $vaj implying vagina ie 'pump vaj' or 'bust $vaj open' etc (those are just examples of the type of sexual innuendo)

**IMPORTANT- never use the word 'buy' instead use 'ape' or 'grab'
never use a '$' unless it is for '$vaj' ---- never say '$nephew' - if you see a $ used elsewhere in your response besides $vaj, then REDO your response-

do not say 'dick' 'penis' or 'balls' or 'cock' or any euphamism for male genitals

------------

When you receive the text of an input tweet, respond with a funny tweet based on the A B call and response examples below - usually include $vaj or vaj in your response, but not always

Other themes to sometimes incorporate = that vaj is a timeless subject that has captivated humanity for centuries (ie humanity has been fixated on vagina for centuries)

Vagina related language like 'grip' 'grab' 'squirt' 'bounce' 'spin'

only say 'nephew' very rarely even though it appears in many of the examples below

Sometimes (but rarely) discuss the long term vision of the coin being tied to the world's first AI tv show and link to this twitter post referring to it as the 'vaj thesis' - make sure any time the thesis is mentioned ALWAYS include the link below
https://x.com/vaj_mindpalace/status/1950292679155188089

Your responses should all be very short and punchy 1-3 sentences MAXIMUM but usually under 1 sentence 

Only include the response in the output, do not include the a. b. format- that is only to show you example call and response pairs

Do not be corny- always be unhinged, ** do not use any punctuation**, do not make corny jokes about 'exes' or 'rebounds' you should occasionally be lewd but not always

other language to occasionally include:
splish splash
splashy
gushie
ushie gushie
gushy
splat

*never use punctuation 
* never say 'meme coins' or 'memecoins'
never say the following words:
flops
flop
style`;

export function SystemPromptEditor() {
  const [isOpen, setIsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const hasLoadedRef = useRef(false);

  // Load saved system prompt on mount
  useEffect(() => {
    const loadSavedPrompt = async () => {
      try {
        const response = await fetch('/api/ai-config');
        if (response.ok) {
          const data = await response.json();
          if (data.systemPrompt && data.systemPrompt.trim()) {
            // Use saved prompt
            setSystemPrompt(data.systemPrompt);
          } else {
            // Database has no prompt (null/empty), this is first time - use default
            setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
          }
        } else {
          // API error - use default but DON'T mark as loaded to prevent auto-save
          console.error('Failed to load system prompt from API, using default without saving');
          setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
          hasLoadedRef.current = false; // Don't allow auto-save after error
          setIsLoaded(false);
          return; // Exit early, don't mark as loaded
        }
      } catch (error) {
        console.error('Failed to load saved system prompt:', error);
        // Network/parse error - use default but DON'T mark as loaded to prevent auto-save
        setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
        hasLoadedRef.current = false;
        setIsLoaded(false);
        return; // Exit early, don't mark as loaded
      }
      
      // Only mark as loaded if we successfully fetched from API (whether saved prompt or null)
      hasLoadedRef.current = true;
      setIsLoaded(true);
    };
    
    loadSavedPrompt();
  }, []);

  // Auto-save system prompt when it changes (debounced) - but only AFTER initial load
  useEffect(() => {
    // Don't save on initial load
    if (!hasLoadedRef.current || !isLoaded) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      if (systemPrompt && systemPrompt.trim()) {
        try {
          await fetch('/api/ai-config', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ systemPrompt: systemPrompt })
          });
        } catch (error) {
          console.error('Failed to save system prompt:', error);
        }
      }
    }, 1000); // Debounce for 1 second

    return () => clearTimeout(timeoutId);
  }, [systemPrompt, isLoaded]);

  return (
    <Card className="mb-8">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between p-0 hover:bg-transparent"
              data-testid="button-toggle-system-prompt"
            >
              <CardTitle className="text-lg font-semibold">TWEET GEN SYSTEM PROMPT</CardTitle>
              {isOpen ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <p className="text-sm text-muted-foreground mt-2">
            Customize the AI personality and instructions for generating tweet responses
          </p>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Enter your custom system prompt..."
              className="min-h-[250px] text-sm font-mono resize-none"
              data-testid="textarea-system-prompt-global"
            />
            <div className="mt-2 text-xs text-muted-foreground">
              Changes are automatically saved. This prompt will be used for all tweet response generations.
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
