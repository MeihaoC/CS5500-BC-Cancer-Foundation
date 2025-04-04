import React, { useState, useEffect } from "react";
import axios from "axios";
import "../css/SingleEventPage.css";
import { useParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import DonorTable from "../components/DonorTable";
import { IoArrowBack, IoLocationSharp, IoCalendarOutline } from "react-icons/io5";
import { MdDelete, MdEdit } from "react-icons/md";
import { FaUser, FaHospital, FaUsers, FaMapMarkedAlt } from "react-icons/fa";
import Topbar from "../components/Topbar";
import Sidebar from "../components/Sidebar";

// API: '/events/:eventId'
function SingleEventPage() {
    // create variables to store event data and navigate to other pages
    const { eventId } = useParams();
    const navigate = useNavigate();

    // Event and donor list data
    const [event, setEvent] = useState([]);
    const [donors, setDonors] = useState([]);

    // Flags to control the donor list UI states
    const [isFormVisible, setIsFormVisible] = useState(false); // indicates a saved donor list exists
    const [isGenerating, setIsGenerating] = useState(false);   // generating a new donor list from scratch
    const [isEditingFinalList, setIsEditingFinalList] = useState(false); // editing an existing donor list
    const [isAddingDonors, setIsAddingDonors] = useState(false); // adding extra donors during editing

    // Temporary donor list used during generation or editing
    const [tempDonorList, setTempDonorList] = useState([]);

    // State for top-level tabs
    const [topTab, setTopTab] = useState("autogenerated");

    // State for sub-tabs under "Autogenerated Donors"
    const [autoSubTab, setAutoSubTab] = useState("best");
    
    // States for tab switching and filtering in generation/adding mode
    const [searchName, setSearchName] = useState("");
    const [filterCity, setFilterCity] = useState("");
    const [filterMedicalFocus, setFilterMedicalFocus] = useState("");
    const [filterEngagement, setFilterEngagement] = useState("");
    
    // States for filter options
    const [cityOptions, setCityOptions] = useState([]);
    const [medicalFocusOptions, setMedicalFocusOptions] = useState([]);

    // Recommended donor lists (for generation or adding donors)
    const [bestMatchedDonors, setBestMatchedDonors] = useState([]);
    const [additionalDonors, setAdditionalDonors] = useState([]);
    const [wasBestMatchedDonors, setWasBestMatchedDonors] = useState([]);
    const [wasAdditionalDonors, setWasAdditionalDonors] = useState([]);
    const [matchedDonors, setMatchedDonors] = useState([]);
    const [wasMatchedDonors, setWasMatchedDonors] = useState([]);

    // fetch event and donors data
    useEffect(() => {
        // create a function to fetch data
        const fetchData = async () => {
            try {
                // fetch the event data
                const eventResponse = await axios.get('http://localhost:5001/api/events/' + eventId + '/details');
                console.log(eventResponse.data);
                setEvent(eventResponse.data);

                // fetch the donors data
                const donorsResponse = await axios.get('http://localhost:5001/api/events/' + eventId + '/donors');
                console.log(donorsResponse.data);
                setDonors(donorsResponse.data || []);
                if (donorsResponse.data && donorsResponse.data.length > 0) {
                    setIsFormVisible(true);
                } else {
                    setIsFormVisible(false);
                }
            } catch (error) {
                // handle errors
                console.error("Failed to fetch event data:", error);
                alert(error.message);
                setEvent([]);
                setDonors([]);
                setIsFormVisible(false);
            }
        };
        // call the fetchEventData function
        fetchData();
    }, [eventId]);

    // New useEffect to set filters after event updates
    useEffect(() => {
        if (event && event.city) {
            setFilterCity(event.city);
            setFilterMedicalFocus(event.medical_focus);
            setFilterEngagement("Highly Engaged");
        }
    }, [event]);

    // delete the event
    const handleDelete = async () => {
        try {
            await axios.delete('http://localhost:5001/api/events/' + eventId);
            alert("Event deleted successfully!");
            navigate('/events');
        } catch (error) {
            // handle errors
            console.error("Failed to delete event:", error);
            alert(error.message);
        }
    };

    // export the donor list
    const handleExport = async () => {
        try {
            // check if there are donors to export
            if (donors.length === 0) {
                alert("No donors to export!");
                return;
            }
            // export the donors
            // get donors data
            const response = await axios.get('http://localhost:5001/api/events/' + eventId + '/donors/export', {
                responseType: 'blob',
            });
            // create a URL to download the file
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `donors_list_${eventId}.csv`);
            // click the link to download the file
            document.body.appendChild(link);
            link.click();
            // remove the link
            link.remove();
            URL.revokeObjectURL(url);

        } catch (error) {
            // handle errors
            console.error("Failed to export donors:", error);
            alert(error.message);
        }
    };

    // Fetch filter options
    useEffect(() => {
        const fetchFilterOptions = async () => {
          try {
            const citiesRes = await axios.get('http://localhost:5001/api/events/cities');
            setCityOptions(citiesRes.data);
          } catch (error) {
            console.error("Failed to fetch city options:", error);
          }
          try {
            const focusRes = await axios.get('http://localhost:5001/api/events/medical-focuses');
            setMedicalFocusOptions(focusRes.data);
          } catch (error) {
            console.error("Failed to fetch medical focus options:", error);
          }
        };
        fetchFilterOptions();
      }, []);

    // Generation mode: Create a new donor list
    const handleGenerateDonorList = () => {
        setIsGenerating(true);
        setTempDonorList([]);
        setTopTab("autogenerated");
        setAutoSubTab("best");
        generateRecommendedDonors();
    };

    // Fetch recommended donors from backend
    const generateRecommendedDonors = async () => {
        try {
            const response = await axios.get(`http://localhost:5001/api/events/${eventId}/suggest-donors`, {
                params: {
                    city: filterCity,
                    medical_focus: filterMedicalFocus,
                    engagement: filterEngagement
                }
            });
            const { best, additional } = response.data;
            setBestMatchedDonors(best);
            setAdditionalDonors(additional);
            setWasAdditionalDonors([]);
            setWasBestMatchedDonors([]);
        } catch (error) {
            console.error("Failed to fetch recommended donors:", error);
            alert("Failed to fetch recommended donors");
        }
    };

    // Search donors by name
    const handleSearchByName = async () => {
        try {
            const response = await axios.get(`http://localhost:5001/api/events/${eventId}/donors/search`, {
                params: { name: searchName }
            });
            if (response.data.length > 0) {
                setMatchedDonors(response.data);
                setWasBestMatchedDonors([]);
            } else {
                setMatchedDonors([]);
                alert("No donors found matching the search criteria.");
            }
        } catch (error) {
            console.error("Donor search failed:", error);
            alert("Donor search failed");
        }
    };

    // Apply filters to regenerate donors
    const handleApplyFilters = async () => {
        try {
            console.log("Filters:", filterCity, filterMedicalFocus, filterEngagement);
            const response = await axios.get(`http://localhost:5001/api/events/${eventId}/suggest-donors`, {
                params: {
                    city: filterCity,
                    medical_focus: filterMedicalFocus,
                    engagement: filterEngagement,
                }
            });
            console.log("Filtered donors:", response.data.best, response.data.additional);
            const { best, additional } = response.data;
            setBestMatchedDonors(best);
            setAdditionalDonors(additional);
        } catch (error) {
            console.error("Failed to fetch donor suggestions:", error);
            alert("Failed to fetch donor suggestions");
        }
    };

    // Add a donor to the temporary list
    const handleAddDonor = async (donor) => {
        try {
            await axios.post(`http://localhost:5001/api/events/${eventId}/donors/add`, { donorId: donor.id });
            if (!tempDonorList.some(d => d.id === donor.id)) {
                setTempDonorList([...tempDonorList, donor]);

                // filter out the selected donor from the recommended lists
                if (bestMatchedDonors.some(d => d.id === donor.id)) {
                    setWasBestMatchedDonors([...wasBestMatchedDonors, donor]);
                    setBestMatchedDonors(bestMatchedDonors.filter(d => d.id !== donor.id));
                } 
                if (additionalDonors.some(d => d.id === donor.id)) {
                    setWasAdditionalDonors([...wasAdditionalDonors, donor]);
                    setAdditionalDonors(additionalDonors.filter(d => d.id !== donor.id));
                }
                if (matchedDonors.some(d => d.id === donor.id)) {
                    setWasMatchedDonors([...wasMatchedDonors, donor]);
                    setMatchedDonors(matchedDonors.filter(d => d.id !== donor.id));
                }
            }
        } catch (error) {
            console.error("Failed to add donor temporarily:", error);
            alert("Failed to add donor");
        }
    };

    // Remove a donor from the temporary list
    const handleRemoveDonor = async (id) => {
        try {
            await axios.post(`http://localhost:5001/api/events/${eventId}/donors/remove`, { donorId: id });
            setTempDonorList(tempDonorList.filter(d => d.id !== id));
            if (wasBestMatchedDonors.some(d => d.id === id)) {
                const donor = wasBestMatchedDonors.find(d => d.id === id);
                setBestMatchedDonors([...bestMatchedDonors, donor]);
                setWasBestMatchedDonors(wasBestMatchedDonors.filter(d => d.id !== id));
            }
            if (wasAdditionalDonors.some(d => d.id === id)) {
                const donor = wasAdditionalDonors.find(d => d.id === id);
                setAdditionalDonors([...additionalDonors, donor]);
                setWasAdditionalDonors(wasAdditionalDonors.filter(d => d.id !== id));
            }
            if (wasMatchedDonors.some(d => d.id === id)) {
                const donor = wasMatchedDonors.find(d => d.id === id);
                setMatchedDonors([...matchedDonors, donor]);
                setWasMatchedDonors(wasMatchedDonors.filter(d => d.id !== id));
            }
        } catch (error) {
            console.error("Failed to remove donor temporarily:", error);
            alert("Failed to remove donor");
        }
    };

    // Cancel generating a new list
    const handleCancelGenerate = async () => {
        try {
            await axios.post(`http://localhost:5001/api/events/${eventId}/donors/cancel`);
            setIsGenerating(false);
            setTempDonorList([]);
        } catch (error) {
            console.error("Failed to cancel donor edits:", error);
            alert("Failed to cancel donor edits");
        }
    };

    // Save generated donor list as final list
    const handleSaveGenerate = async () => {
        try {
            await axios.post(`http://localhost:5001/api/events/${eventId}/donors/save`);
            const donorsResponse = await axios.get(`http://localhost:5001/api/events/${eventId}/donors`);
            setDonors(donorsResponse.data || []);
            setIsGenerating(false);
            setIsFormVisible(true);
            setSearchName("");
            setWasAdditionalDonors([]);
            setWasBestMatchedDonors([]);
            setWasMatchedDonors([]);
            alert("Donor list generated and saved!");
        } catch (error) {
            console.error("Failed to save donor list:", error);
            alert("Failed to save donor list");
        }
    };

    // Edit an existing donor list (initially for deletion only)
    const handleEditDonorList = () => {
        setIsEditingFinalList(true);
        // Start editing with the saved donor list
        setTempDonorList(donors);
    };

    // Cancel editing
    const handleCancelEdit = async () => {
        try {
            await axios.post(`http://localhost:5001/api/events/${eventId}/donors/cancel`);
            setIsEditingFinalList(false);
            setTempDonorList([]);
            setIsAddingDonors(false); // also cancel any add donors UI if open
        } catch (error) {
            console.error("Failed to cancel donor edits:", error);
            alert("Failed to cancel donor edits");
        }
    };

    // Save edited donor list
    const handleSaveEdit = async () => {
        try {
            await axios.post(`http://localhost:5001/api/events/${eventId}/donors/save`);
            const donorsResponse = await axios.get(`http://localhost:5001/api/events/${eventId}/donors`);
            setDonors(donorsResponse.data || []);
            setIsEditingFinalList(false);
            setIsAddingDonors(false);
            setSearchName("");
            setWasAdditionalDonors([]);
            setWasBestMatchedDonors([]);
            setWasMatchedDonors([]);
            alert("Donor list updated!");
            window.location.reload(); // Reload the page to reflect changes
        } catch (error) {
            console.error("Failed to update donor list:", error);
            alert("Failed to update donor list");
        }
    };

    // Handle "Add Donors" action in edit mode:
    // Show the recommended donor lists (similar to generate mode)
    const handleShowAddDonors = () => {
        setIsAddingDonors(true);
        setTopTab("autogenerated");
        setAutoSubTab("best");
        generateRecommendedDonors();
    };

    // Rendering
    if (!event) {
        return <div>Loading...</div>;
    }

    return (
        <div className="app-container">
            <Topbar />
            <div className="main-content">
                <Sidebar />
                <div className="content">
                    <div className="event-container">
                        <button className="back-button" onClick={() => navigate("/events")}>
                            <IoArrowBack className="icon"/>
                        </button>
                        <div className="event-container-main">
                            <div className="event-header">
                                <h1>{event.name}</h1>
                                <div className="donor-edit-buttons">
                                    <button className="delete-button" onClick={handleDelete}>
                                        <MdDelete className="icon"/>  Delete
                                    </button>
                                    <button className="edit-button">
                                        <MdEdit className="icon"/>  Edit
                                    </button>
                                </div>
                            </div>
                            <div className="event-details-grid">
                                <div className="event-card">
                                    <IoCalendarOutline className="icon" />
                                    <div className="event-card-content">
                                        <p>Event Date</p>
                                        <strong>{event.date}</strong>
                                    </div>
                                </div>
                                <div className="event-card">
                                    <IoLocationSharp className="icon" />
                                    <div className="event-card-content">
                                        <p>Event Location</p>
                                        <strong>{event.location}</strong>
                                    </div>
                                </div>
                                <div className="event-card">
                                    <FaMapMarkedAlt className="icon" />
                                    <div className="event-card-content">
                                        <p>Event City</p>
                                        <strong>{event.city}</strong>
                                    </div>
                                </div>
                                <div className="event-card">
                                    <FaHospital className="icon" />
                                    <div className="event-card-content">
                                        <p>Medical Focus</p>
                                        <span className="medical-focus">{event.medical_focus}</span>
                                    </div>
                                </div>
                                <div className="event-card">
                                    <FaUsers className="icon" />
                                    <div className="event-card-content">
                                        <p>Capacity</p>
                                        <strong>{event.capacity}</strong>
                                    </div>
                                </div>
                                <div className="event-card">
                                    <FaUser className="icon" />
                                    <div className="event-card-content">
                                        <p>Coordinator</p>
                                        <strong>{event.coordinator}</strong>
                                    </div>
                                </div>
                                <div className="event-card">
                                    <FaUser className="icon" />
                                    <div className="event-card-content">
                                        <p>Fundraiser</p>
                                        <strong>{event.fundraiser}</strong>
                                    </div>
                                </div>
                            </div>
                            <div className="detailed-info">
                                <h3>Detailed Information</h3>
                                <p>{event.detailed_info}</p>
                            </div>
                        </div>

                        <div className="donor-container">
                            {/* A) No donor list exists: show Generate button */}
                            {!isFormVisible && !isGenerating && !isEditingFinalList && (
                                <div className="generate-button">
                                    <button onClick={handleGenerateDonorList}>
                                        Generate Donor List
                                    </button>
                                </div>
                            )}

                            {/* B) Generating a new donor list from scratch */}
                            {isGenerating && (
                                <div className="donor-edit-form">
                                    <h2>Generate Donor List</h2>

                                    {/* Top-Level Tabs */}
                                    <div className="gen-top-tabs">
                                    <button
                                        className={topTab === "autogenerated" ? "active" : ""}
                                        onClick={() => setTopTab("autogenerated")}
                                    >
                                        Autogenerated Donors
                                    </button>
                                    <button
                                        className={topTab === "search" ? "active" : ""}
                                        onClick={() => setTopTab("search")}
                                    >
                                        Search Donors
                                    </button>
                                    </div>

                                    {/* --- AUTOGENERATED DONORS TAB --- */}
                                    {topTab === "autogenerated" && (
                                    <div className="autogenerated-content">
                                        {/* Filters + Regenerate Button */}
                                        <div className="filters-row">
                                        <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
                                            {cityOptions.map((city, idx) => (
                                            <option key={idx} value={city}>
                                                {city}
                                            </option>
                                            ))}
                                        </select>
                                        <select
                                            value={filterMedicalFocus}
                                            onChange={(e) => setFilterMedicalFocus(e.target.value)}
                                        >
                                            {medicalFocusOptions.map((focus, idx) => (
                                            <option key={idx} value={focus}>
                                                {focus}
                                            </option>
                                            ))}
                                        </select>
                                        <select
                                            value={filterEngagement}
                                            onChange={(e) => setFilterEngagement(e.target.value)}
                                        >
                                            <option value="Highly Engaged">Highly Engaged</option>
                                            <option value="Moderately Engaged">Moderately Engaged</option>
                                            <option value="Rarely Engaged">Rarely Engaged</option>
                                        </select>
                                        <button onClick={handleApplyFilters}>Regenerate</button>
                                        </div>

                                        {/* Sub-Tabs: Best Matched vs Additional Matches */}
                                        <div className="sub-tabs">
                                        <button
                                            className={autoSubTab === "best" ? "active" : ""}
                                            onClick={() => setAutoSubTab("best")}
                                        >
                                            Best Matched Donors
                                        </button>
                                        <button
                                            className={autoSubTab === "additional" ? "active" : ""}
                                            onClick={() => setAutoSubTab("additional")}
                                        >
                                            Additional Matches
                                        </button>
                                        </div>

                                        {/* Donor Tables */}
                                        {autoSubTab === "best" && (
                                        <DonorTable
                                            donors={bestMatchedDonors}
                                            showActions={true}
                                            handleAddDonor={handleAddDonor}
                                        />
                                        )}
                                        {autoSubTab === "additional" && (
                                        <DonorTable
                                            donors={additionalDonors}
                                            showActions={true}
                                            handleAddDonor={handleAddDonor}
                                        />
                                        )}
                                    </div>
                                    )}

                                    {/* --- SEARCH DONORS TAB --- */}
                                    {topTab === "search" && (
                                    <div className="search-content">
                                        <div className="search-bar">
                                        <input
                                            type="text"
                                            value={searchName}
                                            onChange={(e) => setSearchName(e.target.value)}
                                            placeholder="Search donor name"
                                        />
                                        <button onClick={handleSearchByName}>Search</button>
                                        </div>
                                        {matchedDonors.length > 0 ? (
                                        <DonorTable
                                            donors={matchedDonors}
                                            showActions={true}
                                            handleAddDonor={handleAddDonor}
                                        />
                                        ) : (
                                        <p>No donors found.</p>
                                        )}
                                    </div>
                                    )}

                                    {/* Temporary Donor List */}
                                    <div className="temp-donor-list">
                                    <h3>Temporary Donor List</h3>
                                    {tempDonorList.length === 0 ? (
                                        <p>No donors added yet</p>
                                    ) : (
                                        <DonorTable
                                        donors={tempDonorList}
                                        showActions={true}
                                        handleRemoveDonor={handleRemoveDonor}
                                        />
                                    )}
                                    </div>

                                    {/* Bottom Action Buttons */}
                                    <div className="bottom-buttons">
                                    <button onClick={handleCancelGenerate}>Cancel</button>
                                    <button onClick={handleSaveGenerate}>Save</button>
                                    </div>
                                </div>
                                )}

                            {/* C) Finalized donor list view (non-editing) */}
                            {isFormVisible && !isEditingFinalList &&  (
                                <div className="donor-form">
                                    <div className="donor-header">
                                        <h2>Donor List</h2>
                                        <div className="donor-buttons">                            
                                            <button onClick={handleEditDonorList}>Edit</button>
                                            <button onClick={handleExport}>Export</button>
                                        </div>
                                    </div>
                                    <DonorTable donors={donors} showActions={false} />
                                </div>
                            )}

                            {/* D) Editing the finalized donor list */}
                            {isFormVisible && isEditingFinalList && (
                                <div className="donor-edit-form">
                                    <h2>Edit Donor List</h2>
                                    <DonorTable donors={tempDonorList} showActions={true} handleRemoveDonor={handleRemoveDonor} />
                                    <div className="donor-edit-buttons">
                                    {!isAddingDonors && (
                                        <div className="add-donors-button">
                                        <button onClick={handleShowAddDonors}>Add Donors</button>
                                        </div>
                                    )}
                                    <div className="donor-edit-actions">
                                        <button onClick={handleCancelEdit}>Cancel</button>
                                        <button onClick={handleSaveEdit}>Save</button>
                                    </div>
                                    </div>

                                    {isAddingDonors && (
                                    <div className="donor-add-form">
                                        <h3>Add More Donors</h3>
                                        {/* Top-Level Tabs */}
                                        <div className="gen-top-tabs">
                                        <button
                                            className={topTab === "autogenerated" ? "active" : ""}
                                            onClick={() => setTopTab("autogenerated")}
                                        >
                                            Autogenerated Donors
                                        </button>
                                        <button
                                            className={topTab === "search" ? "active" : ""}
                                            onClick={() => setTopTab("search")}
                                        >
                                            Search Donors
                                        </button>
                                        </div>

                                        {/* Autogenerated Donors Content */}
                                        {topTab === "autogenerated" && (
                                        <div className="autogenerated-content">
                                            <div className="filters-row">
                                            <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)}>
                                                {cityOptions.map((city, idx) => (
                                                <option key={idx} value={city}>{city}</option>
                                                ))}
                                            </select>
                                            <select value={filterMedicalFocus} onChange={(e) => setFilterMedicalFocus(e.target.value)}>
                                                {medicalFocusOptions.map((focus, idx) => (
                                                <option key={idx} value={focus}>{focus}</option>
                                                ))}
                                            </select>
                                            <select value={filterEngagement} onChange={(e) => setFilterEngagement(e.target.value)}>
                                                <option value="Highly Engaged">Highly Engaged</option>
                                                <option value="Moderately Engaged">Moderately Engaged</option>
                                                <option value="Rarely Engaged">Rarely Engaged</option>
                                            </select>
                                            <button onClick={handleApplyFilters}>Regenerate</button>
                                            </div>

                                            <div className="sub-tabs">
                                            <button
                                                className={autoSubTab === "best" ? "active" : ""}
                                                onClick={() => setAutoSubTab("best")}
                                            >
                                                Best Matched Donors
                                            </button>
                                            <button
                                                className={autoSubTab === "additional" ? "active" : ""}
                                                onClick={() => setAutoSubTab("additional")}
                                            >
                                                Additional Matches
                                            </button>
                                            </div>

                                            {autoSubTab === "best" && (
                                            <DonorTable donors={bestMatchedDonors} showActions={true} handleAddDonor={handleAddDonor} />
                                            )}
                                            {autoSubTab === "additional" && (
                                            <DonorTable donors={additionalDonors} showActions={true} handleAddDonor={handleAddDonor} />
                                            )}
                                        </div>
                                        )}

                                        {/* Search Donors Content */}
                                        {topTab === "search" && (
                                        <div className="search-content">
                                            <div className="search-bar">
                                            <input
                                                type="text"
                                                value={searchName}
                                                onChange={(e) => setSearchName(e.target.value)}
                                                placeholder="Search donor name"
                                            />
                                            <button onClick={handleSearchByName}>Search</button>
                                            </div>
                                            {matchedDonors.length > 0 ? (
                                            <DonorTable donors={matchedDonors} showActions={true} handleAddDonor={handleAddDonor} />
                                            ) : (
                                            <p>No donors found.</p>
                                            )}
                                        </div>
                                        )}
                                        <div className="donor-add-form-actions">
                                        <button onClick={() => setIsAddingDonors(false)}>Close</button>
                                        </div>
                                    </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SingleEventPage;
