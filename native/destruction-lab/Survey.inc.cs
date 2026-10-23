    // Explicit operator diagnostic; activates only the authored map, never script props.
    void LabIpl(Dictionary<string, string> a)
    {
        if (x7State != "None" || x8Registry.LeaseId != null)
            throw new Exception("ipl_check_requires_no_native_lease");
        string action = S(a, "action", "");
        if (S(a, "approved", "0") != "1" || (action != "request" && action != "remove"))
            throw new Exception("ipl_check_explicit_approval_required");
        const string name = "lsa_destruction_lab";
        bool before = Function.Call<bool>(Hash.IS_IPL_ACTIVE, name);
        if (action == "request") Function.Call(Hash.REQUEST_IPL, name);
        else Function.Call(Hash.REMOVE_IPL, name);
        for (int f = 0; f < 120; f++) Yield();
        Row("lab_ipl_action", "name", name, "action", action, "before", before,
            "after", Function.Call<bool>(Hash.IS_IPL_ACTIVE, name), "scriptPropsCreated", 0);
    }

    // Read-only streaming diagnosis: no IPL/model requests, spawning or damage.
    void LabStream(Dictionary<string, string> a)
    {
        if (x7State != "None" || x8Registry.LeaseId != null)
            throw new Exception("stream_check_requires_no_native_lease");
        foreach(string name in new string[]{"lsa_destruction_lab","ap_sm"})
            Row("lab_ipl","name",name,"active",Function.Call<bool>(Hash.IS_IPL_ACTIVE,name));
        foreach(string name in new string[]{"lsa_destruction_lab","NVE_props_addon","lsa_fence_x7d"})
            Row("lab_dlc","name",name,"present",Function.Call<bool>(Hash.IS_DLC_PRESENT,Game.GenerateHash(name)));
        foreach(string name in new string[]{"prop_fnccorgm_02e","lsa_x7d_secp_j1400"})
        {
            Model m=new Model(name);
            Row("lab_model","name",name,"valid",m.IsValid,"inCdImage",m.IsInCdImage,"loaded",m.IsLoaded);
        }
        PrepareSite();
        Vector3 pivot=new Vector3(F(a,"x",0),F(a,"y",0),F(a,"z",0));
        Game.Player.Character.Position=pivot+new Vector3(0,-8,1.5f);
        WaitCollision(Game.Player.Character);
        for(int f=0;f<120;f++) Yield();
        int h=Function.Call<int>(Hash.GET_CLOSEST_OBJECT_OF_TYPE,pivot.X,pivot.Y,pivot.Z,2f,1185366416,false,false,false);
        RaycastResult r=World.Raycast(pivot+new Vector3(1.2f,-2,1),pivot+new Vector3(1.2f,2,1),(IntersectFlags)17,null);
        Row("lab_source","closestHandle",h,"rayHit",r.DidHit,"rayHandle",r.HitEntity==null?0:r.HitEntity.Handle);
        int hold=(int)F(a,"hold",0); if(hold>0) Hold("lab_stream_observation",Math.Min(hold,15));
    }

    // Site selection only: no spawning, hiding, damage, or selector changes.
    void LabSurvey(Dictionary<string, string> a)
    {
        if (x7State != "None" || x8Registry.LeaseId != null)
            throw new Exception("survey_requires_no_native_lease");
        float x=F(a,"x",0), y=F(a,"y",0), z=F(a,"z",0);
        PrepareSite();
        Game.Player.Character.Position = new Vector3(x,y,z);
        WaitCollision(Game.Player.Character);
        for(int f=0;f<180;f++) Yield();
        foreach(float dx in new float[]{-20,-15,-10,10,15,20})
        foreach(float dy in new float[]{-10,-5,0,5,10})
        {
            Vector3 v=new Vector3(x+dx,y+dy,z);
            RaycastResult r=World.Raycast(v+Vector3.WorldUp*10f,v-Vector3.WorldUp*15f,(IntersectFlags)17,Game.Player.Character);
            Row("lab_survey_ground","x",v.X,"y",v.Y,"hit",r.DidHit,
                "z",r.HitPosition.Z,"nx",r.SurfaceNormal.X,"ny",r.SurfaceNormal.Y,"nz",r.SurfaceNormal.Z,
                "handle",r.HitEntity==null?0:r.HitEntity.Handle);
        }
        foreach(Prop p in World.GetNearbyProps(new Vector3(x,y,z),45f))
            if(p!=null && p.Exists()) Row("lab_survey_prop","hash",p.Model.Hash,
                "x",p.Position.X,"y",p.Position.Y,"z",p.Position.Z);
        Row("lab_survey_player","x",Game.Player.Character.Position.X,
            "y",Game.Player.Character.Position.Y,"z",Game.Player.Character.Position.Z);
    }
